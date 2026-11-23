import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import SoilHealthAssessment from "../client/src/components/soil-health-assessment";
import { soilHealthQueryKey, soilHealthQueryOptions } from "../client/src/lib/soil-health-query";
import { clearAuthenticatedQueryCache } from "../client/src/lib/auth-query-cache";
import { soilHealthInputSchema } from "../shared/soil-health";

afterEach(() => vi.unstubAllGlobals());
describe("Soil-health account and parcel transitions", () => {
  it("remounts the draft session when changing parcel or authenticated account", () => {
    vi.stubGlobal("React", React);
    const a = SoilHealthAssessment({ userId: "owner-A", parcelId: "parcel-A" });
    const b = SoilHealthAssessment({ userId: "owner-A", parcelId: "parcel-B" });
    const otherAccount = SoilHealthAssessment({ userId: "owner-B", parcelId: "parcel-A" });
    // React discards all local draft/edit/selected state for a changed key,
    // including when both parcel queries already have cached data.
    expect(a.key).not.toBe(b.key);
    expect(a.key).not.toBe(otherAccount.key);
    expect(a.key).toBe(SoilHealthAssessment({ userId: "owner-A", parcelId: "parcel-A" }).key);
  });
  it("never renders account A's private assessment to account B with the same QueryClient", () => {
    vi.stubGlobal("React", React);
    const client = new QueryClient();
    const row = { ...soilHealthInputSchema.parse({ assessmentDate: "2026-10-01", responsible: "PRIVATE_ACCOUNT_A_OBSERVER" }), id: "private-visit", parcelId: "parcel-A", authorId: "owner-A", catalogueVersion: "1", createdAt: "2026-10-01T12:00:00Z", updatedAt: "2026-10-01T12:00:00Z", evidence: [] };
    client.setQueryData(soilHealthQueryKey("owner-A", "parcel-A"), { assessments: [row], canEdit: true });
    const render = (userId: string) => renderToStaticMarkup(React.createElement(QueryClientProvider, { client }, React.createElement(SoilHealthAssessment, { userId, parcelId: "parcel-A" })));
    expect(render("owner-A")).toContain("PRIVATE_ACCOUNT_A_OBSERVER");
    const accountB = render("owner-B");
    expect(accountB).not.toContain("PRIVATE_ACCOUNT_A_OBSERVER");
    expect(accountB).not.toContain(">Editar<");
    expect(client.getQueryData(soilHealthQueryKey("owner-B", "parcel-A"))).toBeUndefined();
    client.clear();
  });
  it("clears private query responses and pending requests at logout/account change", async () => {
    const client = new QueryClient();
    const key = soilHealthQueryKey("owner-A", "parcel-A");
    client.setQueryData(key, { assessments: ["private"], canEdit: true });
    let aborted = false;
    const pending = client.fetchQuery({
      queryKey: ["pending-private"],
      queryFn: ({ signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => { aborted = true; reject(new Error("cancelled")); });
      }),
    }).catch(() => undefined);
    await clearAuthenticatedQueryCache(client);
    await pending;
    expect(aborted).toBe(true);
    expect(client.getQueryData(key)).toBeUndefined();
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });
  it("does not inherit infinite staleness or retained parcel data, and fetches with permission checks", async () => {
    const options = soilHealthQueryOptions("owner-A", "parcel-A");
    expect(options.staleTime).toBe(0);
    expect(options.gcTime).toBe(0);
    expect(options.refetchOnMount).toBe("always");
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    vi.stubGlobal("fetch", fetch);
    await expect(options.queryFn({ signal: new AbortController().signal })).rejects.toThrow();
    expect(fetch).toHaveBeenCalledWith("/api/parcels/parcel-A/soil-health", expect.objectContaining({ credentials: "include", cache: "no-store" }));
  });
});