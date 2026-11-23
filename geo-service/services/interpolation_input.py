"""Input lineage for interpolation: never shift residuals onto another sample."""
import numpy as np
from pyproj import Transformer
from shapely.geometry import Point, Polygon
from shapely.ops import transform
from services.raster import utm_epsg_from_latlon


def sanitize_points(points, polygon):
    geom = Polygon(polygon)
    projection = Transformer.from_crs(4326, utm_epsg_from_latlon(geom.centroid.y, geom.centroid.x), always_xy=True)
    allowed = transform(projection.transform, geom).buffer(20)
    coords, values, groups, excluded, warnings = [], [], [], {}, []
    projected = []
    for index, point in enumerate(points):
        try:
            if point.value is None or isinstance(point.value, bool):
                raise ValueError("missing value")
            value = float(point.value)
            if not np.isfinite(value):
                raise ValueError("nonfinite value")
        except (ValueError, TypeError):
            excluded[index] = "invalid_value"
            warnings.append({"code": "invalid_value", "indices": [index], "message": f"Punto {index}: valor nulo o no numérico excluido."})
            continue
        xy = projection.transform(point.lon, point.lat)
        if not allowed.covers(Point(xy)):
            excluded[index] = "outside_polygon"
            warnings.append({"code": "outside_polygon", "indices": [index], "message": f"Punto {index}: fuera del polígono (tolerancia 20 m), excluido."})
            continue
        # Assign to a fixed representative so a long chain cannot join remote samples.
        match = next((i for i, p in enumerate(projected) if np.linalg.norm(np.array(xy) - p) < 1), None)
        if match is None:
            projected.append(np.array(xy))
            coords.append([point.lon, point.lat])
            values.append([value])
            groups.append([index])
        else:
            values[match].append(value)
            groups[match].append(index)
    for group in groups:
        if len(group) > 1:
            warnings.append({"code": "duplicate_coordinates", "indices": group,
                             "message": f"Puntos {group}: coordenadas a menos de 1 m; valores promediados."})
    return np.array(coords, dtype=float).reshape(-1, 2), np.array([np.mean(v) for v in values]), groups, excluded, warnings
