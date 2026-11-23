import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, FeatureGroup, Polygon, Marker, Popup, useMap } from "react-leaflet";
import { EditControl } from "react-leaflet-draw";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";

interface ParcelMapProps {
  initialCoordinates?: [number, number][];
  center?: [number, number];
  zoom?: number;
  fitBoundsTo?: [number, number][] | null;
  coordinateMarker?: [number, number] | null;
  coordinateMarkerLabel?: string;
  onPolygonCreated?: (coordinates: [number, number][], area: number) => void;
  onPolygonDeleted?: () => void;
  readOnly?: boolean;
}

// Inline SVG avoids Leaflet's default icon URL issues in production bundles.
const coordinateMarkerIcon = L.divIcon({
  className: "manual-coordinate-marker",
  html: '<svg xmlns="http://www.w3.org/2000/svg" width="34" height="44" viewBox="0 0 34 44" aria-hidden="true"><path d="M17 42C13 36 2 26 2 17a15 15 0 0 1 30 0c0 9-11 19-15 25Z" fill="#e11d48" stroke="white" stroke-width="2"/><circle cx="17" cy="17" r="5" fill="white"/></svg>',
  iconSize: [34, 44],
  iconAnchor: [17, 44],
  popupAnchor: [0, -42],
});

function calculatePolygonArea(coordinates: [number, number][]): number {
  if (coordinates.length < 3) return 0;
  
  const R = 6371000;
  let total = 0;
  
  for (let i = 0; i < coordinates.length; i++) {
    const j = (i + 1) % coordinates.length;
    const lat1 = (coordinates[i][0] * Math.PI) / 180;
    const lat2 = (coordinates[j][0] * Math.PI) / 180;
    const lng1 = (coordinates[i][1] * Math.PI) / 180;
    const lng2 = (coordinates[j][1] * Math.PI) / 180;
    
    total += (lng2 - lng1) * (2 + Math.sin(lat1) + Math.sin(lat2));
  }
  
  total = Math.abs((total * R * R) / 2);
  return total / 10000;
}

function MapController({
  center,
  zoom,
  fitBoundsTo,
}: {
  center: [number, number];
  zoom: number;
  fitBoundsTo?: [number, number][] | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (fitBoundsTo && fitBoundsTo.length >= 3) {
      const bounds = L.latLngBounds(fitBoundsTo.map(([lat, lng]) => L.latLng(lat, lng)));
      map.fitBounds(bounds, { padding: [20, 20], maxZoom: 18 });
    } else {
      map.setView(center, zoom);
    }
  }, [center, zoom, fitBoundsTo, map]);

  return null;
}

export default function ParcelMap({
  initialCoordinates,
  center = [19.4326, -99.1332],
  zoom = 13,
  fitBoundsTo,
  coordinateMarker,
  coordinateMarkerLabel = "Coordenadas",
  onPolygonCreated,
  onPolygonDeleted,
  readOnly = false,
}: ParcelMapProps) {
  const featureGroupRef = useRef<L.FeatureGroup>(null);
  const [currentPolygon, setCurrentPolygon] = useState<[number, number][] | null>(
    initialCoordinates || null
  );

  useEffect(() => {
    setCurrentPolygon(initialCoordinates || null);
  }, [initialCoordinates]);

  const handleCreated = (e: any) => {
    const layer = e.layer;
    const latLngs = layer.getLatLngs()[0];
    const coordinates: [number, number][] = latLngs.map((ll: L.LatLng) => [ll.lat, ll.lng]);
    
    setCurrentPolygon(coordinates);
    
    if (onPolygonCreated) {
      const area = calculatePolygonArea(coordinates);
      onPolygonCreated(coordinates, area);
    }
  };

  const handleDeleted = () => {
    setCurrentPolygon(null);
    if (onPolygonDeleted) {
      onPolygonDeleted();
    }
  };

  const handleEdited = (e: any) => {
    const layers = e.layers;
    layers.eachLayer((layer: any) => {
      const latLngs = layer.getLatLngs()[0];
      const coordinates: [number, number][] = latLngs.map((ll: L.LatLng) => [ll.lat, ll.lng]);
      
      setCurrentPolygon(coordinates);
      
      if (onPolygonCreated) {
        const area = calculatePolygonArea(coordinates);
        onPolygonCreated(coordinates, area);
      }
    });
  };

  return (
    <div className="w-full h-full rounded-lg overflow-hidden border border-border">
      <MapContainer
        center={center}
        zoom={zoom}
        className="w-full h-full"
        style={{ height: "100%", minHeight: "400px" }}
      >
        <MapController center={center} zoom={zoom} fitBoundsTo={fitBoundsTo} />
        <TileLayer
          attribution='&copy; Esri'
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        />
        <TileLayer
          attribution='&copy; Esri'
          url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
          opacity={0.5}
        />
        {coordinateMarker && (
          <Marker
            position={coordinateMarker}
            icon={coordinateMarkerIcon}
            title={`${coordinateMarkerLabel}: ${coordinateMarker[0]}, ${coordinateMarker[1]}`}
            alt={coordinateMarkerLabel}
          >
            <Popup>
              <strong>{coordinateMarkerLabel}</strong>
              <div>{coordinateMarker[0]}, {coordinateMarker[1]}</div>
            </Popup>
          </Marker>
        )}
        
        {!readOnly && (
          <FeatureGroup ref={featureGroupRef}>
            <EditControl
              position="topright"
              onCreated={handleCreated}
              onDeleted={handleDeleted}
              onEdited={handleEdited}
              draw={{
                rectangle: false,
                circle: false,
                circlemarker: false,
                marker: false,
                polyline: false,
                polygon: currentPolygon ? false : {
                  allowIntersection: false,
                  drawError: {
                    color: "#e1e1e1",
                    message: "No se puede dibujar así",
                  },
                  shapeOptions: {
                    color: "#22c55e",
                    fillColor: "#22c55e",
                    fillOpacity: 0.3,
                  },
                },
              }}
              edit={{
                remove: false,
                edit: {
                  selectedPathOptions: {
                    color: "#22c55e",
                    fillColor: "#22c55e",
                    fillOpacity: 0.4,
                  },
                },
              }}
            />
            {currentPolygon && (
              <Polygon
                positions={currentPolygon}
                pathOptions={{
                  color: "#22c55e",
                  fillColor: "#22c55e",
                  fillOpacity: 0.3,
                }}
              />
            )}
          </FeatureGroup>
        )}
        
        {readOnly && currentPolygon && (
          <Polygon
            positions={currentPolygon}
            pathOptions={{
              color: "#22c55e",
              fillColor: "#22c55e",
              fillOpacity: 0.3,
            }}
          />
        )}
      </MapContainer>
    </div>
  );
}
