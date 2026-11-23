import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  ETAPAS,
  type CalculationResult,
  type MacroKey,
  type MicroKey,
  type SoilInputs,
  type WaterInputs,
  type ProductionSystem,
} from "./nutrition-calculator";

const macroLabels: Record<MacroKey, string> = {
  N: "N",
  P2O5: "P2O5",
  K2O: "K2O",
  CaO: "CaO",
  MgO: "MgO",
  S: "S",
};

const microLabels: Record<MicroKey, string> = {
  Fe: "Fe",
  Cu: "Cu",
  Mn: "Mn",
  Zn: "Zn",
  B: "B",
};

export interface ProductExportRow {
  productName: string;
  unit: string;
  e1Kg: number;
  e2Kg: number;
  e3Kg: number;
  e4Kg: number;
  totalKgLHa: number;
  priceUnit: number;
  costHa: number;
}

export interface NutritionExportData {
  programName: string;
  parcelName?: string;
  ownerName?: string;
  cropName: string;
  variety?: string;
  productionSystem: ProductionSystem;
  rendimientoMeta: number;
  superficieHas: number;
  moo: number;
  notes?: string;
  soil: SoilInputs;
  water?: WaterInputs;
  results: CalculationResult;
  products: ProductExportRow[];
  totalCostHa: number;
  totalCostSup: number;
}

function fmt(n: number, dec = 2): string {
  if (!isFinite(n)) return "—";
  return n.toLocaleString("es-MX", {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}

function safeName(s: string): string {
  return s.replace(/[^a-z0-9-_]+/gi, "_").slice(0, 60) || "programa";
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n;]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadProductsCsv(data: NutritionExportData) {
  const headers = [
    "Producto",
    "Unidad",
    `${ETAPAS[0]} (kg/ha)`,
    `${ETAPAS[1]} (kg/ha)`,
    `${ETAPAS[2]} (kg/ha)`,
    `${ETAPAS[3]} (kg/ha)`,
    "Total/ha",
    "Precio unitario",
    "Costo/ha",
    `Costo total (${fmt(data.superficieHas, 2)} ha)`,
  ];

  const rows: string[][] = data.products.map((p) => [
    p.productName,
    p.unit,
    fmt(p.e1Kg, 2),
    fmt(p.e2Kg, 2),
    fmt(p.e3Kg, 2),
    fmt(p.e4Kg, 2),
    fmt(p.totalKgLHa, 2),
    fmt(p.priceUnit, 2),
    fmt(p.costHa, 2),
    fmt(p.costHa * data.superficieHas, 2),
  ]);

  rows.push([
    "TOTAL",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    fmt(data.totalCostHa, 2),
    fmt(data.totalCostSup, 2),
  ]);

  const meta: string[][] = [
    ["Programa", data.programName],
    ["Cultivo", `${data.cropName}${data.variety ? ` (${data.variety})` : ""}`],
    ["Sistema", data.productionSystem === "fertirriego" ? "Fertirriego" : "Riego rodado"],
    ["Rendimiento meta (ton/ha)", fmt(data.rendimientoMeta, 2)],
    ["Superficie (ha)", fmt(data.superficieHas, 2)],
    ["Parcela", data.parcelName ?? ""],
    ["Productor", data.ownerName ?? ""],
    ["Fecha de exportación", new Date().toLocaleDateString("es-MX")],
    [],
  ];

  const lines: string[] = [];
  for (const m of meta) lines.push(m.map(csvEscape).join(","));
  lines.push(headers.map(csvEscape).join(","));
  for (const r of rows) lines.push(r.map(csvEscape).join(","));

  const csv = "\uFEFF" + lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  triggerDownload(blob, `${safeName(data.programName)}_productos.csv`);
}

export function downloadProgramPdf(data: NutritionExportData) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;
  const today = new Date().toLocaleDateString("es-MX");

  // Letterhead
  doc.setFillColor(21, 94, 47); // green-800
  doc.rect(0, 0, pageWidth, 70, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Programa de Nutrición y Bioestimulación", margin, 30);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(
    "Basado en Oseguera y Sánchez (2015) y NOM-021-SEMARNAT-2000",
    margin,
    48,
  );
  doc.text(`Generado: ${today}`, pageWidth - margin, 48, { align: "right" });

  // Header info
  doc.setTextColor(20, 20, 20);
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text(data.programName, margin, 100);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  const headerLines: string[] = [];
  if (data.ownerName) headerLines.push(`Productor: ${data.ownerName}`);
  if (data.parcelName) headerLines.push(`Parcela: ${data.parcelName}`);
  headerLines.push(
    `Cultivo: ${data.cropName}${data.variety ? ` (${data.variety})` : ""}`,
  );
  headerLines.push(
    `Sistema: ${data.productionSystem === "fertirriego" ? "Fertirriego" : "Riego rodado"}`,
  );
  headerLines.push(
    `Meta: ${fmt(data.rendimientoMeta, 1)} ton/ha   Superficie: ${fmt(data.superficieHas, 2)} ha   MOO: ${fmt(data.moo, 0)} kg N/ha`,
  );
  let y = 118;
  for (const line of headerLines) {
    doc.text(line, margin, y);
    y += 13;
  }

  // Inputs table (soil)
  const soil = data.soil;
  const soilRows: [string, string][] = [
    ["Profundidad (cm)", fmt(soil.profundidadCm, 1)],
    ["Densidad aparente (g/cm³)", fmt(soil.da, 2)],
    ["MOS (%)", fmt(soil.mosPct, 2)],
    ["pH", fmt(soil.ph, 2)],
    ["CE (dS/m)", fmt(soil.ce, 2)],
    ["N inorgánico (ppm)", fmt(soil.nInorgPpm, 2)],
    ["P (ppm)", fmt(soil.pPpm, 2)],
    ["K (ppm)", fmt(soil.kPpm, 2)],
    ["Ca (ppm)", fmt(soil.caPpm, 2)],
    ["Mg (ppm)", fmt(soil.mgPpm, 2)],
    ["S (ppm)", fmt(soil.sPpm, 2)],
    ["Fe (ppm)", fmt(soil.fePpm, 2)],
    ["Cu (ppm)", fmt(soil.cuPpm, 2)],
    ["Mn (ppm)", fmt(soil.mnPpm, 2)],
    ["Zn (ppm)", fmt(soil.znPpm, 2)],
    ["B (ppm)", fmt(soil.bPpm, 2)],
  ];

  autoTable(doc, {
    startY: y + 4,
    head: [["Análisis de suelo", "Valor"]],
    body: soilRows,
    theme: "striped",
    headStyles: { fillColor: [21, 94, 47] },
    styles: { fontSize: 8, cellPadding: 3 },
    margin: { left: margin, right: margin },
    columnStyles: { 1: { halign: "right" } },
  });

  let cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;

  // Water (optional)
  if (data.water) {
    const w = data.water;
    const waterRows: [string, string][] = [
      ["pH", fmt(w.ph ?? 0, 2)],
      ["CE (dS/m)", fmt(w.ce ?? 0, 2)],
      ["Ca (meq/L)", fmt(w.caMeq ?? 0, 2)],
      ["Mg (meq/L)", fmt(w.mgMeq ?? 0, 2)],
      ["K (meq/L)", fmt(w.kMeq ?? 0, 2)],
      ["Na (meq/L)", fmt(w.naMeq ?? 0, 2)],
      ["NO3 (meq/L)", fmt(w.no3Meq ?? 0, 2)],
      ["SO4 (meq/L)", fmt(w.so4Meq ?? 0, 2)],
      ["HCO3 (meq/L)", fmt(w.hco3Meq ?? 0, 2)],
      ["Cl (meq/L)", fmt(w.clMeq ?? 0, 2)],
    ];
    autoTable(doc, {
      startY: cursorY,
      head: [["Análisis de agua", "Valor"]],
      body: waterRows,
      theme: "striped",
      headStyles: { fillColor: [21, 94, 47] },
      styles: { fontSize: 8, cellPadding: 3 },
      margin: { left: margin, right: margin },
      columnStyles: { 1: { halign: "right" } },
    });
    cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;

    if (data.results.water) {
      const wr = data.results.water;
      autoTable(doc, {
        startY: cursorY,
        head: [["Indicador del agua", "Valor"]],
        body: [
          ["SAR", fmt(wr.sar, 2)],
          ["Dureza (°f)", fmt(wr.durezaGhf, 1)],
          ["Σ cationes (meq/L)", fmt(wr.sumCationes, 2)],
          ["Σ aniones (meq/L)", fmt(wr.sumAniones, 2)],
          ["Ácido sulfúrico 98% (ml/m³)", fmt(wr.acidoSulfuricoMlM3, 2)],
        ],
        theme: "grid",
        headStyles: { fillColor: [21, 94, 47] },
        styles: { fontSize: 8, cellPadding: 3 },
        margin: { left: margin, right: margin },
        columnStyles: { 1: { halign: "right" } },
      });
      cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;
    }
  }

  // Macros formula
  const macros = data.results.macros;
  const macroRows = (Object.keys(macros) as MacroKey[]).map((k) => {
    const m = macros[k];
    const isN = k === "N";
    const dosis = isN ? data.results.nAjustado : m.dosis;
    const tipo = m.factorAjuste < 0 ? "Déficit" : "Mantenimiento";
    return [macroLabels[k], fmt(dosis, 1), tipo];
  });

  autoTable(doc, {
    startY: cursorY,
    head: [["Fórmula de fertilización (kg/ha)", "Dosis", "Tipo"]],
    body: macroRows,
    theme: "grid",
    headStyles: { fillColor: [21, 94, 47] },
    styles: { fontSize: 9, cellPadding: 4 },
    margin: { left: margin, right: margin },
    columnStyles: { 1: { halign: "right" }, 2: { halign: "center" } },
  });
  cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  doc.setFontSize(8);
  doc.setTextColor(80, 80, 80);
  doc.text(
    `Nm (N mineralizado por MOS): ${fmt(data.results.nm, 1)} kg/ha · MOO: ${fmt(data.moo, 0)} kg/ha · N bruto: ${fmt(macros.N.dosis, 1)} kg/ha → N ajustado: ${fmt(data.results.nAjustado, 1)} kg/ha`,
    margin,
    cursorY + 4,
    { maxWidth: pageWidth - margin * 2 },
  );
  cursorY += 18;
  doc.setTextColor(20, 20, 20);

  // Micros
  const micros = data.results.micros;
  const microRows = (Object.keys(micros) as MicroKey[]).map((k) => {
    const m = micros[k];
    return [
      microLabels[k],
      fmt(m.dosis, 2),
      m.foliarRecomendado ? "Foliar recomendado" : "Suelo",
    ];
  });
  autoTable(doc, {
    startY: cursorY,
    head: [["Micronutrimentos (g/ha)", "Dosis", "Vía"]],
    body: microRows,
    theme: "grid",
    headStyles: { fillColor: [21, 94, 47] },
    styles: { fontSize: 9, cellPadding: 4 },
    margin: { left: margin, right: margin },
    columnStyles: { 1: { halign: "right" }, 2: { halign: "center" } },
  });
  cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;

  // Phenological distribution
  const distHead = ["Nutrimento", ...ETAPAS.map((e) => e), "Total"];
  const distBody = (Object.keys(macros) as MacroKey[]).map((k) => {
    const m = macros[k];
    const total = ETAPAS.reduce((s, e) => s + (m.distribucion[e] || 0), 0);
    return [
      macroLabels[k],
      ...ETAPAS.map((e) => fmt(m.distribucion[e] || 0, 1)),
      fmt(total, 1),
    ];
  });
  autoTable(doc, {
    startY: cursorY,
    head: [distHead],
    body: distBody,
    theme: "striped",
    headStyles: { fillColor: [21, 94, 47], fontSize: 8 },
    styles: { fontSize: 8, cellPadding: 3, halign: "right" },
    margin: { left: margin, right: margin },
    columnStyles: { 0: { halign: "left", fontStyle: "bold" } },
  });
  cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;

  // Products
  const productHead = [
    "Producto",
    "Unidad",
    ETAPAS[0],
    ETAPAS[1],
    ETAPAS[2],
    ETAPAS[3],
    "Total/ha",
    "$ unit.",
    "Costo/ha",
  ];
  const productBody: (string | number)[][] = data.products.map((p) => [
    p.productName,
    p.unit,
    fmt(p.e1Kg, 1),
    fmt(p.e2Kg, 1),
    fmt(p.e3Kg, 1),
    fmt(p.e4Kg, 1),
    fmt(p.totalKgLHa, 2),
    fmt(p.priceUnit, 2),
    `$${fmt(p.costHa, 2)}`,
  ]);
  productBody.push([
    { content: "Total por hectárea", colSpan: 8, styles: { halign: "right", fontStyle: "bold" } } as never,
    { content: `$${fmt(data.totalCostHa, 2)}`, styles: { halign: "right", fontStyle: "bold" } } as never,
  ]);
  productBody.push([
    {
      content: `Total para ${fmt(data.superficieHas, 2)} ha`,
      colSpan: 8,
      styles: { halign: "right", fontStyle: "bold" },
    } as never,
    { content: `$${fmt(data.totalCostSup, 2)}`, styles: { halign: "right", fontStyle: "bold" } } as never,
  ]);

  autoTable(doc, {
    startY: cursorY,
    head: [productHead],
    body: productBody,
    theme: "grid",
    headStyles: { fillColor: [21, 94, 47], fontSize: 8 },
    styles: { fontSize: 8, cellPadding: 3, halign: "right" },
    margin: { left: margin, right: margin },
    columnStyles: { 0: { halign: "left" }, 1: { halign: "center" } },
  });
  cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;

  // Notes
  if (data.notes && data.notes.trim()) {
    if (cursorY > doc.internal.pageSize.getHeight() - 100) {
      doc.addPage();
      cursorY = margin;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Notas del técnico", margin, cursorY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const noteLines = doc.splitTextToSize(data.notes, pageWidth - margin * 2);
    doc.text(noteLines, margin, cursorY + 14);
  }

  // Footer page numbers
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(
      `Página ${i} de ${pageCount}`,
      pageWidth - margin,
      doc.internal.pageSize.getHeight() - 20,
      { align: "right" },
    );
    doc.text(
      data.programName,
      margin,
      doc.internal.pageSize.getHeight() - 20,
    );
  }

  doc.save(`${safeName(data.programName)}.pdf`);
}
