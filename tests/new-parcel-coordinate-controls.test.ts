import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Exercise the page's actual event handlers with deterministic hook state.
// No authentication bypass, real geolocation, storage writes or map tiles.
const harness = vi.hoisted(() => ({
  state: [] as any[],
  effects: [] as { deps?: any[]; cleanup?: () => void }[],
  pending: [] as (() => void)[],
  cursor: 0,
  effectCursor: 0,
  toast: vi.fn(),
  gpsSuccess: undefined as undefined | ((position: any) => void),
  t: (key: string) => key,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: any) => {
      const index = harness.cursor++;
      if (!(index in harness.state)) harness.state[index] = typeof initial === "function" ? initial() : initial;
      return [harness.state[index], (value: any) => {
        harness.state[index] = typeof value === "function" ? value(harness.state[index]) : value;
      }];
    },
    useEffect: (effect: () => any, deps?: any[]) => {
      const index = harness.effectCursor++;
      const previous = harness.effects[index];
      if (!previous || !deps || deps.some((value, i) => !Object.is(value, previous.deps?.[i]))) {
        harness.pending.push(() => {
          previous?.cleanup?.();
          harness.effects[index] = { deps, cleanup: effect() };
        });
      }
    },
  };
});
vi.mock("@/lib/i18n-context", () => ({ useI18n: () => ({ t: harness.t }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: harness.toast }) }));
vi.mock("wouter", () => ({ Link: "a", useLocation: () => ["/new-parcel", vi.fn()] }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/parcel-import", () => ({ parseParcelFile: vi.fn() }));

import NewParcel from "../client/src/pages/new-parcel";
import { parseParcelFile } from "../client/src/lib/parcel-import";

function render() {
  harness.cursor = 0;
  harness.effectCursor = 0;
  harness.pending = [];
  const tree = NewParcel();
  for (const effect of harness.pending) effect();
  return tree;
}
function nodes(node: any): React.ReactElement<any>[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  return React.isValidElement<any>(node) ? [node, ...nodes(node.props.children)] : [];
}
function control(tree: any, testId: string) {
  const element = nodes(tree).find((node) => node.props["data-testid"] === testId);
  if (!element) throw new Error(`Missing control ${testId}`);
  return element.props;
}
function map(tree: any) {
  return nodes(tree).find((node) => typeof node.props.onPolygonCreated === "function")!.props;
}
function enterCoordinates(lat: string, lng: string) {
  let tree = render();
  control(tree, "button-location-manual").onClick();
  tree = render();
  control(tree, "input-manual-lat").onChange({ target: { value: lat } });
  control(tree, "input-manual-lng").onChange({ target: { value: lng } });
  return render();
}

beforeEach(() => {
  harness.state = [];
  harness.effects = [];
  harness.toast.mockClear();
  harness.gpsSuccess = undefined;
  vi.stubGlobal("React", React);
  vi.stubGlobal("navigator", { geolocation: {
    getCurrentPosition: vi.fn((success) => { harness.gpsSuccess = success; }),
  } });
});
afterEach(() => {
  for (const effect of harness.effects) effect.cleanup?.();
  vi.unstubAllGlobals();
});

describe("New-parcel coordinate controls", () => {
  it("centers on decimal-comma input and preserves the drawn polygon and its area", () => {
    const polygon = [[19, -99], [19.01, -99], [19, -99.01]];
    const initial = render();
    map(initial).onPolygonCreated(polygon, 1.14);
    const tree = enterCoordinates("20,6736", "-103,344");
    control(tree, "button-go-to-coords").onClick();
    const updated = render();
    expect(map(updated).center).toEqual([20.6736, -103.344]);
    expect(map(updated).coordinateMarker).toEqual([20.6736, -103.344]);
    expect(map(updated).initialCoordinates).toBe(polygon);
    expect(JSON.stringify(updated)).toContain("1.14");
  });

  it("Enter navigates once without submitting the parcel form", () => {
    const tree = enterCoordinates("0", "0");
    expect(control(tree, "button-go-to-coords").disabled).toBe(false);
    const preventDefault = vi.fn();
    control(tree, "input-manual-lng").onKeyDown({ key: "Enter", preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(map(render()).center).toEqual([0, 0]);
    expect(map(render()).coordinateMarker).toEqual([0, 0]);
  });

  it("rejects trailing text and out-of-range values without changing the viewport", () => {
    for (const [lat, lng] of [["19abc", "-99"], ["91", "-99"], ["19", "-181"]]) {
      const tree = enterCoordinates(lat, lng);
      const original = map(tree).center;
      control(tree, "button-go-to-coords").onClick();
      expect(map(render()).center).toBe(original);
    }
    expect(harness.toast).toHaveBeenCalledTimes(3);
    expect(harness.toast).toHaveBeenCalledWith({ title: "newParcel.invalidCoords", variant: "destructive" });
  });

  it("disables the button for whitespace-only input", () => {
    const tree = enterCoordinates(" ", "-99");
    expect(control(tree, "button-go-to-coords").disabled).toBe(true);
  });

  it("starts without a marker, moves the single marker, and preserves it on invalid input", () => {
    expect(map(render()).coordinateMarker).toBeNull();
    let tree = enterCoordinates("19", "-99");
    control(tree, "button-go-to-coords").onClick();
    expect(map(render()).coordinateMarker).toEqual([19, -99]);
    tree = enterCoordinates("20", "-103");
    control(tree, "button-go-to-coords").onClick();
    expect(map(render()).coordinateMarker).toEqual([20, -103]);
    tree = enterCoordinates("bad", "-103");
    control(tree, "button-go-to-coords").onClick();
    expect(map(render()).coordinateMarker).toEqual([20, -103]);
  });

  it("ignores a late GPS response after manual mode was selected", () => {
    render();
    const staleGpsSuccess = harness.gpsSuccess!;
    const tree = enterCoordinates("20", "-103");
    control(tree, "button-go-to-coords").onClick();
    staleGpsSuccess({ coords: { latitude: 19, longitude: -99 } });
    expect(map(render()).center).toEqual([20, -103]);
  });

  it("clears imported fit bounds so manual navigation works, without clearing the imported lot", async () => {
    const polygon: [number, number][] = [[19, -99], [19.01, -99], [19, -99.01]];
    vi.mocked(parseParcelFile).mockResolvedValue({
      features: [{ coordinates: polygon, areaHa: 1.14, name: "Fixture" }],
    } as any);
    let tree = render();
    control(tree, "button-location-import").onClick();
    tree = render();
    await control(tree, "input-parcel-file").onChange({ target: { files: [{ name: "fixture.kml" }], value: "fixture.kml" } });
    expect(map(render()).fitBoundsTo).toBe(polygon);
    tree = enterCoordinates("20", "-103");
    control(tree, "button-go-to-coords").onClick();
    const updated = render();
    expect(map(updated).fitBoundsTo).toBeNull();
    expect(map(updated).center).toEqual([20, -103]);
    expect(map(updated).coordinateMarker).toEqual([20, -103]);
    expect(map(updated).initialCoordinates).toBe(polygon);
    expect(control(updated, "input-manual-lat").inputMode).toBe("decimal");
  });
});
