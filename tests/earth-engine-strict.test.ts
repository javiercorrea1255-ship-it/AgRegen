import { describe, expect, it } from "vitest";
import { getAvailableSentinelImages } from "../server/services/earth-engine";

describe("Strict satellite catalogue", () => {
  it("does not fall back to simulated dates when Earth Engine has not been initialized", async () => {
    await expect(getAvailableSentinelImages({
      coordinates: [[20, -103], [20.003, -103], [20.003, -102.997], [20, -102.997]],
    }, 3, { allowSynthetic: false })).rejects.toThrow("no disponible");
  });
});
