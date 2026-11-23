import { beforeEach, describe, expect, it, vi } from "vitest";

const pgMocks = vi.hoisted(() => ({
  connect: vi.fn(),
  end: vi.fn(),
}));

vi.mock("pg", () => ({
  Pool: class MockPool {
    connect = pgMocks.connect;
    end = pgMocks.end;
  },
}));

import { seedMexicoSoil } from "../server/seed-mexico-soil";

describe("seedMexicoSoil startup resilience", () => {
  beforeEach(() => {
    pgMocks.connect.mockReset();
    pgMocks.end.mockReset().mockResolvedValue(undefined);
  });

  it("does not reject startup when PostgreSQL connection fails", async () => {
    pgMocks.connect.mockRejectedValueOnce(new Error("Authentication timed out"));
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(seedMexicoSoil()).resolves.toBeUndefined();

    expect(pgMocks.end).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("failed (non-fatal): Authentication timed out"));
    log.mockRestore();
  });
});