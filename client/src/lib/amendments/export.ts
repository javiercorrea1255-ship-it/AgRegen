import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { MODULE_LABELS_ES } from "./constants";
import type { ComputedSample } from "./types";

function fmt(n: number, dec = 2): string {
  if (!isFinite(n)) return "—";
  return n.toLocaleString("es-MX", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function safeName(s: string): string {
  return s.replace(/[^a-z0-9-_]+/gi, "_").slice(0, 60) || "enmiendas";
}

const STATUS_LABEL: Record<string, string> = {
  optimo: "Óptimo",
  aceptable: "Aceptable",
  deficiente: "Deficiente",
  critico: "Crítico",
};

export function downloadAmendmentsPdf(projectName: string, computed: ComputedSample[]) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const margin = 40;

  // Cover
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Calculadora de enmiendas de suelo", margin, 60);
  doc.setFontSize(13);
  doc.setFont("helvetica", "normal");
  doc.text(projectName, margin, 82);
  doc.setFontSize(10);
  doc.setTextColor(120);
  const dateStr = new Date().toLocaleDateString("es-MX", {
    year: "numeric", month: "long", day: "numeric",
  });
  doc.text(`Generado: ${dateStr}`, margin, 100);
  doc.setTextColor(0);

  // 1. Sample data
  autoTable(doc, {
    startY: 130,
    head: [["Muestra", "%Ca", "%Mg", "%K", "%Na", "%H", "%Al", "CIC", "pH", "%MO", "Área (ha)"]],
    body: computed.map(({ sample }) => [
      sample.name,
      fmt(sample.pct_Ca),
      fmt(sample.pct_Mg),
      fmt(sample.pct_K),
      fmt(sample.pct_Na),
      fmt(sample.pct_H),
      fmt(sample.pct_Al),
      fmt(sample.CIC),
      sample.pH != null ? fmt(sample.pH) : "—",
      sample.MO_pct != null ? fmt(sample.MO_pct) : "—",
      fmt(sample.area_ha),
    ]),
    headStyles: { fillColor: [45, 106, 79], textColor: 255, fontStyle: "bold" },
    styles: { fontSize: 8, cellPadding: 4 },
    margin: { left: margin, right: margin },
    didDrawPage: () => {
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.text("1. Datos de análisis de suelo", margin, 122);
    },
  });

  // 2. Computed meq
  let y = (doc as any).lastAutoTable?.finalY ?? 200;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("2. Valores calculados (meq/100 g)", margin, y + 26);
  autoTable(doc, {
    startY: y + 36,
    head: [["Muestra", "Ca", "Mg", "K", "Na", "H", "Al"]],
    body: computed.map(({ sample, meq }) => [
      sample.name, fmt(meq.Ca, 3), fmt(meq.Mg, 3), fmt(meq.K, 3),
      fmt(meq.Na, 3), fmt(meq.H, 3), fmt(meq.Al, 3),
    ]),
    headStyles: { fillColor: [45, 106, 79], textColor: 255, fontStyle: "bold" },
    styles: { fontSize: 8, cellPadding: 4 },
    margin: { left: margin, right: margin },
  });

  // 3. Ratios
  y = (doc as any).lastAutoTable?.finalY ?? 200;
  doc.setFont("helvetica", "bold");
  doc.text("3. Relaciones catiónicas", margin, y + 26);
  autoTable(doc, {
    startY: y + 36,
    head: [["Muestra", "Ca/Mg (2-6)", "Mg/K (2-3)", "(Ca+Mg)/K (20-30)", "Ca/K (10-15)"]],
    body: computed.map(({ sample, ratios }) => [
      sample.name,
      fmt(ratios.Ca_Mg),
      fmt(ratios.Mg_K),
      fmt(ratios.CaMg_K),
      fmt(ratios.Ca_K),
    ]),
    headStyles: { fillColor: [45, 106, 79], textColor: 255, fontStyle: "bold" },
    styles: { fontSize: 8, cellPadding: 4 },
    margin: { left: margin, right: margin },
  });

  // 4. Diagnosis per sample
  y = (doc as any).lastAutoTable?.finalY ?? 200;
  doc.setFont("helvetica", "bold");
  doc.text("4. Diagnóstico por muestra", margin, y + 26);
  autoTable(doc, {
    startY: y + 36,
    head: [["Muestra", "Estado", "Módulos activos"]],
    body: computed.map(({ sample, diagnosis }) => {
      const active = (Object.keys(MODULE_LABELS_ES) as Array<keyof typeof MODULE_LABELS_ES>)
        .filter((k) => diagnosis[k].active)
        .map((k) => `${MODULE_LABELS_ES[k]}: ${diagnosis[k].reason}`)
        .join("\n");
      return [sample.name, STATUS_LABEL[diagnosis.status] ?? diagnosis.status, active || "Ninguno"];
    }),
    headStyles: { fillColor: [45, 106, 79], textColor: 255, fontStyle: "bold" },
    styles: { fontSize: 8, cellPadding: 4 },
    columnStyles: { 2: { cellWidth: 320 } },
    margin: { left: margin, right: margin },
  });

  // 5. Recommended amendments matrix
  y = (doc as any).lastAutoTable?.finalY ?? 200;
  if (y > 600) {
    doc.addPage();
    y = 40;
  }
  doc.setFont("helvetica", "bold");
  doc.text("5. Enmiendas recomendadas", margin, y + 26);
  autoTable(doc, {
    startY: y + 36,
    head: [[
      "Muestra",
      "MgSO₄ (kg/ha)",
      "Yeso-Na (t/ha)",
      "Cal (t/ha)",
      "Dolomita (t/ha)",
      "K₂SO₄ (kg/ha)",
      "MO (t/ha)",
      "Yeso-Ca (t/ha)",
      "S (kg/ha)",
    ]],
    body: computed.map(({ sample, amendments: a }) => [
      sample.name,
      a.magnesio.active ? fmt(a.magnesio.dose_kg_ha, 0) : "—",
      a.sodio.active ? fmt(a.sodio.dose_ton_ha, 2) : "—",
      a.encalado.active ? fmt(a.encalado.dose_ton_ha, 2) : "—",
      a.dolomita.active ? fmt(a.dolomita.dose_ton_ha, 2) : "—",
      a.potasio.active ? fmt(a.potasio.dose_kg_ha, 0) : "—",
      a.carbono.active ? fmt(a.carbono.dose_ton_ha, 2) : "—",
      a.enyesado.active ? fmt(a.enyesado.dose_ton_ha, 2) : "—",
      a.azufre.active ? fmt(a.azufre.dose_kg_ha, 0) : "—",
    ]),
    headStyles: { fillColor: [45, 106, 79], textColor: 255, fontStyle: "bold" },
    styles: { fontSize: 7, cellPadding: 3 },
    margin: { left: margin, right: margin },
  });

  // 6. Totals per area
  y = (doc as any).lastAutoTable?.finalY ?? 200;
  doc.setFont("helvetica", "bold");
  doc.text("6. Totales por superficie aplicada", margin, y + 26);
  autoTable(doc, {
    startY: y + 36,
    head: [[
      "Muestra", "Área (ha)",
      "MgSO₄ (kg)", "Yeso-Na (t)", "Cal (t)", "Dolomita (t)",
      "K₂SO₄ (kg)", "MO (t)", "Yeso-Ca (t)", "S (kg)",
    ]],
    body: computed.map(({ sample, amendments: a }) => [
      sample.name, fmt(sample.area_ha),
      a.magnesio.active ? fmt(a.magnesio.total_kg, 0) : "—",
      a.sodio.active ? fmt(a.sodio.total_ton, 2) : "—",
      a.encalado.active ? fmt(a.encalado.total_ton, 2) : "—",
      a.dolomita.active ? fmt(a.dolomita.total_ton, 2) : "—",
      a.potasio.active ? fmt(a.potasio.total_kg, 0) : "—",
      a.carbono.active ? fmt(a.carbono.total_ton, 2) : "—",
      a.enyesado.active ? fmt(a.enyesado.total_ton, 2) : "—",
      a.azufre.active ? fmt(a.azufre.total_kg, 0) : "—",
    ]),
    headStyles: { fillColor: [45, 106, 79], textColor: 255, fontStyle: "bold" },
    styles: { fontSize: 7, cellPadding: 3 },
    margin: { left: margin, right: margin },
  });

  // Footer
  const pageCount = (doc as any).internal.getNumberOfPages?.() ?? 1;
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(140);
    doc.text(
      "AgRegen — Calculadora de enmiendas de suelo. Recomendaciones técnicas; ajustar al criterio agronómico local.",
      margin,
      doc.internal.pageSize.getHeight() - 24,
    );
    doc.text(`Página ${i} de ${pageCount}`,
      doc.internal.pageSize.getWidth() - margin - 60,
      doc.internal.pageSize.getHeight() - 24);
  }

  doc.save(`${safeName(projectName)}_enmiendas.pdf`);
}
