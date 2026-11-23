"""Static, north-up PNG from supplied real index pixels. No imagery or fake values."""
import json
import sys
from io import BytesIO
from PIL import Image, ImageDraw, ImageFont
from matplotlib.font_manager import findfont, FontProperties


def render(data):
    raster, summary = data["raster"], data["summary"]
    previous = data.get("previous")
    comparison = bool(data.get("compare"))
    if comparison and not previous:
        raise ValueError("A comparison needs two actual rasters")
    canvas = Image.new("RGB", (1000, 1100), "#f8faf6")
    draw = ImageDraw.Draw(canvas)
    font_file = findfont(FontProperties(family="DejaVu Sans"))
    font = lambda size: ImageFont.truetype(font_file, size)
    name = str(data["name"])[:48]
    draw.text((45, 22), name, fill="#183d2b", font=font(32))
    title = "Vigor NDVI" if summary["index"] == "ndvi" else "Humedad NDMI"
    if comparison:
        title = "Cambio de " + title.lower()
    draw.text((45, 69), title, fill="#183d2b", font=font(28))
    date = summary["imageDate"]
    if comparison:
        date = summary["previousDate"] + " → " + date
    draw.text((45, 108), date, fill="#46574c", font=font(23))
    minx, miny, maxx, maxy = (raster["bbox"][k] for k in ("minx", "miny", "maxx", "maxy"))
    import math
    ratio = ((maxx - minx) * math.cos(math.radians((miny + maxy) / 2))) / (maxy - miny)
    width, height = (880, min(690, round(880 / ratio))) if ratio >= 880 / 690 else (round(690 * ratio), 690)
    width, height = max(1, width), max(1, height)
    left, top = (1000 - width) // 2, 170 + (690 - height) // 2
    layer = Image.new("RGB", (width, height), "#d1d5db")
    pixels = ImageDraw.Draw(layer)
    colors = ["#c83c35", "#f1d35c", "#268547"]
    thresholds = summary["thresholds"]
    for r, row in enumerate(raster["values"]):
        for c, value in enumerate(row):
            valid = value is not None and -1 <= value <= 1
            if comparison:
                before = previous["values"][r][c]
                valid = valid and before is not None and -1 <= before <= 1
                value = value - before if valid else None
                limits = [-0.05, 0.05]
            else:
                limits = thresholds
            middle = value is not None and (value <= limits[1] if comparison else value < limits[1])
            color = "#c9ced1" if not valid else colors[0 if value < limits[0] else 1 if middle else 2]
            pixels.rectangle((round(c * width / raster["cols"]), round(r * height / raster["rows"]),
                              round((c + 1) * width / raster["cols"]), round((r + 1) * height / raster["rows"])), fill=color)
    contour = [((lon - minx) / (maxx - minx) * width, (maxy - lat) / (maxy - miny) * height)
               for lat, lon in data["coordinates"]]
    mask = Image.new("L", (width, height), 0)
    ImageDraw.Draw(mask).polygon(contour, fill=255)
    canvas.paste(layer, (left, top), mask)
    draw.line([(left + x, top + y) for x, y in contour + [contour[0]]], fill="#122d20", width=5)
    draw.text((918, 160), "N", fill="#183d2b", font=font(26))
    draw.polygon([(930, 200), (919, 233), (930, 225), (941, 233)], fill="#183d2b")
    labels = ["Bajó", "Se mantuvo", "Mejoró"] if comparison else (
        ["Bajo", "Medio", "Alto"] if summary["index"] == "ndvi" else ["Baja", "Media", "Alta"])
    for i, label in enumerate(labels):
        x = 60 + i * 300
        draw.rectangle((x, 890, x + 30, 920), fill=colors[i])
        draw.text((x + 42, 889), label, fill="#183d2b", font=font(24))
    draw.rectangle((60, 944, 90, 974), fill="#c9ced1")
    draw.text((102, 943), "Gris: borde o sin lectura (no necesariamente nubes)", fill="#46574c", font=font(22))
    footer = f"Sentinel-2 · resolución de malla {summary['resolutionM']} m · norte arriba"
    draw.text((45, 1000), footer, fill="#46574c", font=font(20))
    draw.text((45, 1035), "Niveles orientativos; el satélite no confirma un diagnóstico.", fill="#46574c", font=font(19))
    result = BytesIO()
    canvas.save(result, format="PNG", optimize=True)
    return result.getvalue()


if __name__ == "__main__":
    sys.stdout.buffer.write(render(json.load(sys.stdin)))
