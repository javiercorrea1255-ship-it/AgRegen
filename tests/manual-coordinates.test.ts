import { describe, expect, it } from "vitest";
import { parseManualCoordinates } from "../client/src/lib/manual-coordinates";

describe("Manual decimal-degree coordinates", () => {
  it.each([
    ["19.4326", "-99.1332", [19.4326, -99.1332]],
    ["19,4326", "-99,1332", [19.4326, -99.1332]],
    [" -19.5 ", " +99.5 ", [-19.5, 99.5]],
    ["0", "0", [0, 0]],
    ["90", "180", [90, 180]],
    ["-90", "-180", [-90, -180]],
    [".5", "-.5", [0.5, -0.5]],
  ])("parses %s, %s without swapping latitude and longitude", (lat, lng, expected) => {
    expect(parseManualCoordinates(lat, lng)).toEqual(expected);
  });

  it.each([
    ["", "-99"], ["19", ""], [" ", " "],
    ["90.0001", "-99"], ["-90.0001", "-99"],
    ["19", "180.0001"], ["19", "-180.0001"],
    ["19abc", "-99"], ["19.5 N", "-99"], ["19", "-99junk"],
    ["19,4326,5", "-99"], ["19.4326,5", "-99"],
    ["NaN", "-99"], ["Infinity", "-99"], ["19", "-Infinity"],
    ["1e2", "-99"], ["0x10", "-99"], ["19 30 20", "-99"],
    ["19.4326, -99.1332", "-99"],
  ])("rejects invalid or incomplete input %s, %s", (lat, lng) => {
    expect(parseManualCoordinates(lat, lng)).toBeNull();
  });
});
