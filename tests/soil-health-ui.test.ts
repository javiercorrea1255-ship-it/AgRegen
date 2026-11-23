import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import SoilHealthAssessment, { SoilHealthSummary } from "../client/src/components/soil-health-assessment";
import { soilHealthInputSchema, soilHealthIndicators, type SoilHealthAssessment as Assessment } from "../shared/soil-health";
import { soilHealthQueryKey } from "../client/src/lib/soil-health-query";

afterEach(() => vi.unstubAllGlobals());
function visit(id: string, date: string, answers = {}): Assessment {
  return { ...soilHealthInputSchema.parse({ assessmentDate: date, responsible: "Verification", answers }), id, parcelId: "fixture", authorId: "fixture-owner", catalogueVersion: "1", createdAt: `${date}T12:00:00Z`, updatedAt: `${date}T12:00:00Z`, evidence: [] };
}
function render(records: Assessment[], canEdit = true, summary = false) {
  // The project's test transformer uses classic JSX for imported TSX files.
  vi.stubGlobal("React", React);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(soilHealthQueryKey("fixture-owner", "fixture"), { assessments: records, canEdit });
  const component = summary ? React.createElement(SoilHealthSummary, { parcelId: "fixture", userId: "fixture-owner", onOpen: () => {} }) : React.createElement(SoilHealthAssessment, { parcelId: "fixture", userId: "fixture-owner" });
  const markup = renderToStaticMarkup(React.createElement(QueryClientProvider, { client }, component));
  client.clear();
  return markup;
}
describe("Soil-health rendered UI", () => {
  it("renders a real empty state and owner-only creation controls", () => {
    expect(render([])).toContain("Iniciar primera visita");
    expect(render([], false)).not.toContain("Iniciar primera visita");
    expect(render([], false)).toContain("acceso de consulta");
  });
  it("renders all 19 indicators and null compliance for an unevaluated visit", () => {
    const html = render([visit("base", "2026-10-01")]);
    for (const indicator of soilHealthIndicators) expect(html).toContain(indicator.name);
    expect(html).toContain("Línea base");
    expect(html).toContain("Sin evaluar");
    expect(html).toContain("Cumplimiento evaluado");
    expect(html).not.toContain("0% de salud");
    expect(html).toContain("no calcula un índice científico");
  });
  it("renders improved, worsened, unchanged and incomparable rows against earliest baseline", () => {
    const html = render([
      visit("later", "2026-10-01", { cover: { answer: "yes" }, ph: { answer: "no" }, salts: { answer: "yes" } }),
      visit("base", "2026-09-01", { cover: { answer: "no" }, ph: { answer: "yes" }, salts: { answer: "yes" } }),
    ]);
    expect(html).toContain("<table");
    for (const label of ["Mejoró", "Empeoró", "Sin cambio", "No comparable", "Aspectos que requieren atención"]) expect(html).toContain(label);
  });
  it("removes edit/delete controls for a read-only parcel visitor", () => {
    const html = render([visit("base", "2026-10-01")], false);
    expect(html).not.toContain(">Editar<");
    expect(html).not.toContain("Eliminar</button>");
  });
  it("shows latest visit and evaluated coverage out of 19 in the overview", () => {
    const html = render([visit("base", "2026-09-01"), visit("later", "2026-10-01", { cover: { answer: "yes" } })], true, true);
    expect(html).toContain("1/1 cumplidos");
    expect(html).toContain("18 sin evaluar");
    expect(html).toContain("cobertura 1/19");
    expect(html).toContain("Ver evaluación");
  });
});