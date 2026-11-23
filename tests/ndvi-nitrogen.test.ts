import { describe, expect, it } from "vitest";
import { ndviNitrogenRule } from "../shared/ndvi-nitrogen";

describe("versioned NDVI nitrogen bands", () => {
  it.each([
    [-1, 80], [0.199999, 80], [0.20, 50], [0.399999, 50],
    [0.40, 40], [0.499999, 40], [0.50, 30], [0.549999, 30], [0.55, 20], [1, 20],
  ])("uses %s to select %s kg N/ha without rounding", (ndvi, dose) => {
    expect(ndviNitrogenRule(ndvi)).toMatchObject({ dose, version: "1.0.0", unit: "kg N/ha" });
  });

  it.each([NaN, Infinity, -1.01, 1.01])("rejects invalid NDVI %s", ndvi => {
    expect(() => ndviNitrogenRule(ndvi)).toThrow(RangeError);
  });
});
