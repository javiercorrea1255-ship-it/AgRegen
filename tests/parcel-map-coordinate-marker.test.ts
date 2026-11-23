import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("leaflet", () => ({ default: { divIcon: (options: any) => options } }));
vi.mock("leaflet/dist/leaflet.css", () => ({}));
vi.mock("leaflet-draw/dist/leaflet.draw.css", () => ({}));
vi.mock("react-leaflet-draw", () => ({ EditControl: () => null }));
vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: any) => React.createElement("div", {}, children),
  TileLayer: () => null,
  FeatureGroup: React.forwardRef(({ children }: any, _ref) => React.createElement("section", { "data-feature-group": true }, children)),
  Polygon: ({ positions }: any) => React.createElement("span", { "data-polygon": JSON.stringify(positions) }),
  Marker: ({ children, position, title, alt, icon }: any) => React.createElement("div", {
    "data-coordinate-marker": JSON.stringify(position),
    "data-icon": icon.html,
    "data-anchor": JSON.stringify(icon.iconAnchor),
    title,
    "aria-label": alt,
  }, children),
  Popup: ({ children }: any) => React.createElement("aside", {}, children),
  useMap: () => ({ setView: vi.fn(), fitBounds: vi.fn() }),
}));

import ParcelMap from "../client/src/components/map/parcel-map";

afterEach(() => vi.unstubAllGlobals());

describe("Parcel coordinate marker rendering", () => {
  it("does not display a marker before coordinates are confirmed", () => {
    vi.stubGlobal("React", React);
    const html = renderToStaticMarkup(React.createElement(ParcelMap));
    expect(html).not.toContain("data-coordinate-marker");
  });

  it("shows a single red pin at the exact point, separately from the editable polygon", () => {
    vi.stubGlobal("React", React);
    const html = renderToStaticMarkup(React.createElement(ParcelMap, {
      coordinateMarker: [20.6736, -103.344],
      coordinateMarkerLabel: "Coordenadas Manuales",
      initialCoordinates: [[20, -103], [20.01, -103], [20, -103.01]],
    }));
    expect(html.match(/data-coordinate-marker=/g)).toHaveLength(1);
    expect(html).toContain('data-coordinate-marker="[20.6736,-103.344]"');
    expect(html).toContain("Coordenadas Manuales: 20.6736, -103.344");
    expect(html).toContain("20.6736, -103.344</div>");
    expect(html).toContain('data-anchor="[17,44]"');
    expect(html).toContain("#e11d48");
    expect(html).toContain("data-polygon");
    expect(html.indexOf("data-coordinate-marker")).toBeLessThan(html.indexOf("data-feature-group"));
  });
});
