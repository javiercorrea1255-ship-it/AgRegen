import numpy as np
import io
import base64
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
from typing import Tuple, Optional, Dict


# Per-variable colormaps: divergent/sequential as appropriate
COLORMAPS: dict = {
    # Vegetation indices — green ramp
    "ndvi":     "RdYlGn",
    "evi":      "RdYlGn",
    "ndmi":     "RdYlBu",
    # Soil chemical
    "ph":       "RdYlGn",   # low=acid(red) → optimal(green) → alkaline(blue implied)
    "mo":       "YlOrBr",   # low=yellow → high=brown (organic matter accumulation)
    "n":        "Blues",
    "p":        "Oranges",
    "k":        "Purples",
    "ca":       "PuBu",
    "mg":       "BuGn",
    # Salinity
    "ce":       "RdYlGn_r", # low=good(green) → high salinity=red
    # Physical
    "sm":       "YlGnBu",   # soil moisture
    "temp":     "RdBu_r",
    "hg":       "Blues",    # hydraulic conductivity
    "rp":       "RdYlGn_r", # resistance penetration (high=bad)
    "clay":     "YlOrBr",
    # Yield / general
    "yield":    "RdYlGn",
    "default":  "RdYlGn",
}


def values_to_png_base64(
    values: np.ndarray,
    vmin: Optional[float] = None,
    vmax: Optional[float] = None,
    cmap_name: str = "default",
    width: int = 400,
    height: int = 400,
    add_alpha: bool = True,
) -> str:
    """Convierte grid de valores a PNG codificado en base64 con rampa de color."""
    from PIL import Image

    cmap_key = (cmap_name or "default").lower()
    cmap_str = COLORMAPS.get(cmap_key, COLORMAPS["default"])

    arr = values.astype(float).copy()
    nan_mask = np.isnan(arr)

    if vmin is None:
        vmin = float(np.nanmin(arr))
    if vmax is None:
        vmax = float(np.nanmax(arr))
    if vmax - vmin < 1e-9:
        center = (vmin + vmax) / 2.0
        half = max(1e-3, abs(center) * 0.05)
        vmin, vmax = center - half, center + half

    norm = mcolors.Normalize(vmin=vmin, vmax=vmax)
    colormap = plt.get_cmap(cmap_str)

    arr_flipped = np.flipud(arr)
    nan_flipped = np.flipud(nan_mask)

    rgba = colormap(norm(arr_flipped))  # shape: (H, W, 4)

    # Make NaN pixels transparent
    if add_alpha:
        rgba[nan_flipped, 3] = 0.0
        colored_px = (rgba * 255).astype(np.uint8)
        img = Image.fromarray(colored_px, "RGBA")
    else:
        colored_px = (rgba[:, :, :3] * 255).astype(np.uint8)
        img = Image.fromarray(colored_px, "RGB")

    img = img.resize((width, height), Image.NEAREST)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return base64.b64encode(buf.read()).decode("utf-8")


def make_grid(
    bbox: Tuple[float, float, float, float],
    resolution: int = 100,
    cell_centers: bool = False,
) -> Tuple[np.ndarray, np.ndarray]:
    """Crea meshgrid lon/lat a partir del bounding box."""
    minx, miny, maxx, maxy = bbox
    xs = minx + (np.arange(resolution) + .5) * (maxx - minx) / resolution if cell_centers else np.linspace(minx, maxx, resolution)
    ys = miny + (np.arange(resolution) + .5) * (maxy - miny) / resolution if cell_centers else np.linspace(miny, maxy, resolution)
    grid_x, grid_y = np.meshgrid(xs, ys)
    return grid_x, grid_y


def utm_epsg_from_latlon(lat: float, lon: float) -> int:
    """F2-06: Compute UTM EPSG code for a centroid (lat, lon).

    zone = floor((lon + 180) / 6) + 1
    Northern hemisphere → EPSG:326xx; Southern → EPSG:327xx.
    """
    zone = int((lon + 180) / 6) + 1
    return 32600 + zone if lat >= 0 else 32700 + zone


def values_to_geotiff_bytes(
    values: np.ndarray,
    bbox: Dict[str, float],
    projection: str = "wgs84",
) -> bytes:
    """Genera GeoTIFF Float32 en memoria.

    F2-06: acepta projection='utm' para exportar en CRS métrico UTM automático.

    Parámetros
    ----------
    values     : np.ndarray shape (H, W) — grid de valores; NaN = fuera del polígono
    bbox       : dict {minx, miny, maxx, maxy} — coordenadas WGS84 del bounding-box
    projection : 'wgs84' (default) | 'utm' (CRS métrico automático basado en centroide)

    Retorna bytes del archivo .tif listos para descargar.
    NaN → NoData = -9999.0

    Orientación: la interpolación produce filas sur→norte (row 0 = miny).
    GeoTIFF north-up requiere row 0 = norte, por lo que se aplica flipud.
    """
    import rasterio
    from rasterio.transform import from_bounds
    from rasterio.io import MemoryFile

    NODATA = -9999.0
    z = np.array(values, dtype=np.float32)
    height, width = z.shape

    z_out = np.where(np.isnan(z), NODATA, z)
    z_north_up = np.flipud(z_out)

    if projection == "utm":
        try:
            import pyproj
            cy = (bbox["miny"] + bbox["maxy"]) / 2
            cx = (bbox["minx"] + bbox["maxx"]) / 2
            target_epsg = utm_epsg_from_latlon(cy, cx)
            transformer = pyproj.Transformer.from_crs(
                "EPSG:4326", f"EPSG:{target_epsg}", always_xy=True,
            )
            minx_u, miny_u = transformer.transform(bbox["minx"], bbox["miny"])
            maxx_u, maxy_u = transformer.transform(bbox["maxx"], bbox["maxy"])
            crs_str = f"EPSG:{target_epsg}"
            transform_out = from_bounds(
                west=minx_u, south=miny_u, east=maxx_u, north=maxy_u,
                width=width, height=height,
            )
        except ImportError:
            # pyproj not available — fall back to WGS84
            projection = "wgs84"

    if projection != "utm":
        crs_str = "EPSG:4326"
        transform_out = from_bounds(
            west=bbox["minx"], south=bbox["miny"],
            east=bbox["maxx"], north=bbox["maxy"],
            width=width, height=height,
        )

    with MemoryFile() as memfile:
        with memfile.open(
            driver="GTiff",
            height=height,
            width=width,
            count=1,
            dtype="float32",
            crs=crs_str,
            transform=transform_out,
            nodata=NODATA,
        ) as ds:
            ds.write(z_north_up, 1)
        return memfile.read()
