#!/usr/bin/env python3
"""
Import Mexico state soil data from INIFAP Excel files into mexico_soil_samples.

Coordinate formats handled:
  1. DMS strings  — "14 43 11.37N" / "92 15 58.4W"
  2. UTM meters   — LATITUD=northing, LONGITUD=easting
  3. UTM Y/X cols — Y=northing, X=easting
  4. Inverted X/Y — X=northing(str), Y=easting(str)  (NvoLeon only)

Zone assignment: each state has an ordered list of zones to try.
The first zone whose conversion falls inside the state's tight bbox is used.
This handles states that span two UTM zone boundaries (Chihuahua, Jalisco, etc.)
"""
import os, re, sys, unicodedata
import openpyxl
import psycopg2
from psycopg2.extras import execute_values
from pyproj import Transformer

# ── DB ────────────────────────────────────────────────────────────────────────
DB_URL = os.environ.get("DATABASE_URL")
if not DB_URL:
    sys.exit("DATABASE_URL not set")

BASE = "/home/runner/workspace/attached_assets/"

# States already in DB from the original shapefile — skip to avoid duplication
ALREADY_IN_DB = {
    "AGUASCALIENTES","CHIAPAS","GUERRERO","HIDALGO","MEXICO",
    "MORELOS","PUEBLA","QUINTANAROO","SAN LUIS POTOSI","TLAXCALA","ZACATECAS",
}

# ── Per-state config: try_zones (ordered) + tight bbox ────────────────────────
# For each coordinate pair, we try each zone in order and accept the first
# conversion that falls within the state's bounding box.
# bbox = (lat_min, lat_max, lng_min, lng_max)
STATE_CONFIG: dict[str, tuple[list[int], tuple[float,float,float,float]]] = {
    # Western Chihuahua (Sierra Tarahumara) → zone 12N
    # Central/eastern Chihuahua (valleys)   → zone 13N
    "CHIHUAHUA":  ([13, 12], (25.4, 32.1, -109.3, -102.8)),
    # Coahuila is solidly zone 14N
    "COAHUILA":   ([14],     (24.4, 30.0, -104.1, -99.1)),
    # Colima is small and entirely zone 13N
    "COLIMA":     ([13],     (18.6, 19.6, -104.9, -103.4)),
    # Durango spans 13N (west) and 14N (east)
    "DURANGO":    ([13, 14], (22.3, 26.9, -107.6, -102.9)),
    # Guanajuato is zone 14N
    "GUANAJUATO": ([14],     (19.8, 22.0, -102.3, -99.5)),
    # Jalisco spans 13N (most) and 14N (far east)
    "JALISCO":    ([13, 14], (18.6, 23.2, -106.4, -101.1)),
    # Michoacán: 13N for western coast, 14N for eastern inland
    "MICHOACAN":  ([13, 14], (17.8, 20.6, -104.8, -99.9)),
    # Nuevo León is zone 14N
    "NUEVO LEON": ([14],     (22.9, 28.0, -101.4, -98.3)),
    # Oaxaca: 14N (west/center), 15N (far east near Tehuantepec)
    "OAXACA":     ([14, 15], (15.5, 18.9, -98.7, -93.4)),
    # Querétaro is zone 14N
    "QUERETARO":  ([14],     (19.9, 21.9, -100.8, -98.9)),
    # Sinaloa: 12N (north/west), 13N (central/east valleys)
    "SINALOA":    ([12, 13], (22.2, 27.2, -109.7, -104.7)),
    # Sonora: mostly 12N, extreme northwest is 11N
    "SONORA":     ([12, 11], (26.0, 32.7, -115.2, -108.3)),
    # Yucatán is zone 16N
    "YUCATAN":    ([16],     (19.4, 21.8, -90.7, -87.1)),
    # Campeche: 15N (most), 16N (far east)
    "CAMPECHE":   ([15, 16], (17.6, 21.0, -92.8, -88.9)),
    # CDMX is entirely zone 14N
    "CDMX":       ([14],     (18.9, 19.7, -99.5, -98.8)),
}

# ── UTM transformers cache ────────────────────────────────────────────────────
_TF: dict[int, Transformer] = {}
def get_tf(zone: int) -> Transformer:
    if zone not in _TF:
        _TF[zone] = Transformer.from_crs(
            f"EPSG:{32600 + zone}", "EPSG:4326", always_xy=True
        )
    return _TF[zone]

def try_utm(northing: float, easting: float,
            zones: list[int],
            lat_min: float, lat_max: float,
            lng_min: float, lng_max: float):
    """Try each zone in order; return (lat, lon) for the first valid hit."""
    for zone in zones:
        try:
            lon, lat = get_tf(zone).transform(easting, northing)
            if lat_min <= lat <= lat_max and lng_min <= lon <= lng_max:
                return round(lat, 8), round(lon, 8)
        except Exception:
            pass
    return None, None

# ── DMS parser ────────────────────────────────────────────────────────────────
_DMS_RE = re.compile(r"(\d+)\s+(\d+)\s+([\d.]+)\s*([NSEWnsew])")
def parse_dms(s) -> float | None:
    s = str(s).strip()
    m = _DMS_RE.match(s)
    if m:
        dd = float(m.group(1)) + float(m.group(2))/60 + float(m.group(3))/3600
        return -dd if m.group(4).upper() in ("S", "W") else dd
    try:
        return float(s)
    except (TypeError, ValueError):
        return None

# ── Misc helpers ──────────────────────────────────────────────────────────────
def normalize_estado(s) -> str:
    if not s:
        return ""
    s = "".join(c for c in unicodedata.normalize("NFD", str(s).upper().strip())
                if unicodedata.category(c) != "Mn")
    for src, dst in [
        ("QUINTANA ROO",    "QUINTANAROO"),
        ("DISTRITO FEDERAL","CDMX"),
        ("CIUDAD DE MEXICO","CDMX"),
        ("MICHOACAN DE OCAMPO","MICHOACAN"),
        ("QUERETARO DE ARTEAGA","QUERETARO"),
        ("COAHUILA DE ZARAGOZA","COAHUILA"),
        ("VERACRUZ DE IGNACIO DE LA LLAVE","VERACRUZ"),
    ]:
        s = s.replace(src, dst)
    return s

def to_float(v):
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None

def h_idx(headers: list[str], *candidates: str) -> int:
    hl = [h.lower() for h in headers]
    for c in candidates:
        try:
            return hl.index(c.lower())
        except ValueError:
            pass
    return -1

# ── File list ─────────────────────────────────────────────────────────────────
FILES = [
    "Chihuahua_1782097735664.xlsx",
    "Coahuila_1782097735664.xlsx",
    "Colima_1782097735665.xlsx",
    "Durango_1782097735665.xlsx",
    "Guanajuato_1782097735666.xlsx",
    "Jalisco_1782097735666.xlsx",
    "Michoacan_1782097735666.xlsx",
    "NvoLeon_1782097735667.xlsx",
    "Oaxaca_1782097735667.xlsx",
    "Queretaro_1782097735667.xlsx",
    "Sinaloa_1782097735668.xlsx",
    "Sonora_1782097735668.xlsx",
    "Yucatan_1782097735668.xlsx",
    "Campeche_1782097735668.xlsx",
    "CDMX_1782097735668.xlsx",
]

# ── Import one file ───────────────────────────────────────────────────────────
def import_file(cur, path: str) -> tuple[str, int, int]:
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws  = wb.active
    raw = list(next(ws.iter_rows(max_row=1, values_only=True)))
    H   = [str(h).strip() if h else "" for h in raw]

    # Coordinate column indices
    lat_idx = h_idx(H, "LATITUD", "Y")
    lon_idx = h_idx(H, "LONGITUD", "X")

    # Detect DMS format from first data row
    first_data = list(ws.iter_rows(min_row=2, max_row=2, values_only=True))[0]
    is_dms = (lat_idx >= 0 and
              isinstance(first_data[lat_idx], str) and
              _DMS_RE.search(str(first_data[lat_idx])))

    # Chemical columns
    i_estado    = h_idx(H, "ESTADO", "Estado")
    i_municipio = h_idx(H, "MUNICIPIO", "Municipio")
    i_localidad = h_idx(H, "LOCALIDAD", "Localidad")
    i_lab       = h_idx(H, "Muestra")
    i_ph        = h_idx(H, "pH", "Ph")
    i_ce        = h_idx(H, "CE")
    i_mo        = h_idx(H, "MO", "M_O")
    i_n         = h_idx(H, "N")
    i_metp      = h_idx(H, "Extr", "Extra", "Extracció", "Extraccion")
    i_p         = h_idx(H, "P", "P_1")
    i_k         = h_idx(H, "K", "K_1")
    i_ca        = h_idx(H, "Ca", "Ca1")
    i_mg        = h_idx(H, "Mg", "Mg_1")
    i_fe        = h_idx(H, "Fe", "Fe_1")
    i_zn        = h_idx(H, "Zn", "Zn_1")
    i_mn        = h_idx(H, "Mn", "Mn_1")
    i_cu        = h_idx(H, "Cu", "Cu1")
    i_b         = h_idx(H, "B", "B_1")
    i_na        = h_idx(H, "Na", "Na_1")
    i_cic       = h_idx(H, "CIC")
    i_tex       = h_idx(H, "Textura")

    rows_ok, rows_skip = 0, 0
    batch: list = []

    for row in ws.iter_rows(min_row=2, values_only=True):
        if all(v is None for v in row):
            continue

        # Estado
        estado = normalize_estado(row[i_estado] if i_estado >= 0 else None)
        if not estado or estado in ALREADY_IN_DB:
            rows_skip += 1
            continue

        cfg = STATE_CONFIG.get(estado)
        if cfg is None:
            rows_skip += 1
            continue
        zones, (la_mn, la_mx, lo_mn, lo_mx) = cfg

        # Coordinates
        c1 = row[lat_idx] if lat_idx >= 0 else None
        c2 = row[lon_idx] if lon_idx >= 0 else None

        if is_dms:
            lat = parse_dms(c1)
            lon = parse_dms(c2)
            if lon is not None and lon > 0:
                lon = -lon
            if lat is None or lon is None:
                rows_skip += 1; continue
            if not (la_mn <= lat <= la_mx and lo_mn <= lon <= lo_mx):
                rows_skip += 1; continue
        else:
            try:
                v1, v2 = float(c1), float(c2)
            except (TypeError, ValueError):
                rows_skip += 1; continue

            # NvoLeon quirk: X col = northing, Y col = easting (our mapping
            # puts lat_idx→Y col and lon_idx→X col, so v1=Y=easting, v2=X=northing).
            # Detect by checking which value is larger (northing 1.5M-3.7M vs easting <900k).
            northing, easting = (v2, v1) if v1 < 1_000_000 < v2 else (v1, v2)

            lat, lon = try_utm(northing, easting, zones, la_mn, la_mx, lo_mn, lo_mx)
            if lat is None:
                rows_skip += 1; continue

        def v(idx): return to_float(row[idx]) if idx >= 0 else None
        lab = str(int(row[i_lab])) if i_lab >= 0 and row[i_lab] is not None else None
        mun = str(row[i_municipio]).strip() if i_municipio >= 0 and row[i_municipio] else None
        loc = str(row[i_localidad]).strip() if i_localidad >= 0 and row[i_localidad] else None
        mtp = str(row[i_metp]).strip()      if i_metp >= 0     and row[i_metp]     else None
        tex = str(row[i_tex]).strip()       if i_tex >= 0      and row[i_tex]      else None

        batch.append((
            lab, estado, mun, loc, None,
            str(lat), str(lon),
            v(i_ph), v(i_ce), None, v(i_mo), v(i_n), mtp,
            v(i_p), v(i_k), v(i_ca), v(i_mg), v(i_fe), v(i_zn),
            v(i_b), v(i_mn), v(i_cu), None, None, None, v(i_na), v(i_cic),
            tex,
        ))
        rows_ok += 1

        if len(batch) >= 500:
            _flush(cur, batch); batch.clear()

    if batch:
        _flush(cur, batch)

    return os.path.basename(path), rows_ok, rows_skip

# ── SQL ───────────────────────────────────────────────────────────────────────
SQL_INSERT = """
INSERT INTO mexico_soil_samples
  (lab_number, estado, municipio, localidad, loteu,
   lat, lng,
   ph, ce, dap, mo, n, met_p,
   p, k, ca, mg, fe, zn,
   b, mn, cu, arcilla, limo, arena, na, cic,
   textura)
VALUES %s
ON CONFLICT DO NOTHING
"""
def _flush(cur, batch):
    execute_values(cur, SQL_INSERT, batch, page_size=500)

# ── Entry point ───────────────────────────────────────────────────────────────
def main():
    conn = psycopg2.connect(DB_URL)
    cur  = conn.cursor()
    total_ok = 0

    for fn in FILES:
        path = BASE + fn
        if not os.path.exists(path):
            print(f"  MISSING: {fn}"); continue
        try:
            name, ok, skip = import_file(cur, path)
            conn.commit()
            total_ok += ok
            print(f"  {name}: {ok} inserted, {skip} skipped")
        except Exception as e:
            conn.rollback()
            print(f"  ERROR {fn}: {e}")

    cur.execute("""
        SELECT estado, COUNT(*) FROM mexico_soil_samples
        GROUP BY estado ORDER BY estado
    """)
    print("\nRecords per estado in DB:")
    for row in cur.fetchall():
        print(f"  {row[0]}: {row[1]}")
    print(f"\nTotal new rows inserted: {total_ok}")
    cur.close(); conn.close()

if __name__ == "__main__":
    main()
