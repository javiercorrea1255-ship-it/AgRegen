/**
 * Unit tests for server/services/carbon-market.ts
 *
 * Covers:
 *  - Successful Gold Standard Marketplace scrape → returns median price
 *  - Empty or malformed response → returns null
 *  - Prices outside sanity range are filtered
 *  - Cache is respected (fetch called only once within TTL)
 *  - resetVCMCache helper clears the cache
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// We mock globalThis.fetch so no real network call happens
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Import AFTER stubbing so the module picks up the mock
import { getVCMPrice, resetVCMCache } from "../server/services/carbon-market";

function makeShopifyResponse(prices: string[]): string {
  return JSON.stringify({
    products: prices.map((price) => ({
      variants: [{ price }],
    })),
  });
}

function mockOkResponse(body: string): Response {
  return {
    ok: true,
    text: async () => body,
  } as unknown as Response;
}

function mockFailResponse(status = 500): Response {
  return { ok: false, status } as unknown as Response;
}

beforeEach(() => {
  resetVCMCache();
  mockFetch.mockReset();
});

describe("getVCMPrice — successful scrape", () => {
  it("returns median of listed prices", async () => {
    mockFetch.mockResolvedValueOnce(
      mockOkResponse(makeShopifyResponse(["10.00", "12.00", "15.00", "20.00", "25.00"]))
    );

    const result = await getVCMPrice();

    expect(result).not.toBeNull();
    expect(result!.price).toBe(15); // median of [10,12,15,20,25]
    expect(result!.currency).toBe("USD");
    expect(result!.source).toContain("Gold Standard");
    expect(result!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("filters prices outside $3–$80 sanity range", async () => {
    // $1 (below min) and $200 (above max) should be excluded
    mockFetch.mockResolvedValueOnce(
      mockOkResponse(makeShopifyResponse(["1.00", "12.00", "15.00", "200.00"]))
    );

    const result = await getVCMPrice();

    expect(result).not.toBeNull();
    // Only $12 and $15 are valid → median of [12,15] = 15
    expect(result!.price).toBe(15);
  });
});

describe("getVCMPrice — failure / missing data", () => {
  it("returns null when server responds with non-ok status", async () => {
    mockFetch.mockResolvedValueOnce(mockFailResponse(503));

    const result = await getVCMPrice();

    expect(result).toBeNull();
  });

  it("returns null when response body is empty", async () => {
    mockFetch.mockResolvedValueOnce(mockOkResponse(""));

    const result = await getVCMPrice();

    expect(result).toBeNull();
  });

  it("returns null when products array is empty", async () => {
    mockFetch.mockResolvedValueOnce(
      mockOkResponse(JSON.stringify({ products: [] }))
    );

    const result = await getVCMPrice();

    expect(result).toBeNull();
  });

  it("returns null when all prices fall outside sanity range", async () => {
    mockFetch.mockResolvedValueOnce(
      mockOkResponse(makeShopifyResponse(["0.50", "99.00", "150.00"]))
    );

    const result = await getVCMPrice();

    expect(result).toBeNull();
  });

  it("returns null on network error (fetch throws)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const result = await getVCMPrice();

    expect(result).toBeNull();
  });
});

describe("getVCMPrice — caching", () => {
  it("calls fetch only once within the cache TTL", async () => {
    mockFetch.mockResolvedValue(
      mockOkResponse(makeShopifyResponse(["12.00", "15.00"]))
    );

    await getVCMPrice();
    await getVCMPrice();
    await getVCMPrice();

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("re-fetches after resetVCMCache()", async () => {
    mockFetch.mockResolvedValue(
      mockOkResponse(makeShopifyResponse(["12.00"]))
    );

    await getVCMPrice();
    resetVCMCache();
    await getVCMPrice();

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
