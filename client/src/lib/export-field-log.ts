import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export interface FieldLogExportRow {
  date: string;
  activity: string;
  status: string;
  detail: string;
  quantities: string;
  cost: string;
}

export interface FieldLogExportOptions {
  parcelName?: string;
  filters?: string;
  rows: FieldLogExportRow[];
  summary?: string;
}

function safeName(value: string) {
  return value.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ\s-]/g, "_").trim() || "parcela";
}

export function downloadFieldLogPdf(options: FieldLogExportOptions): void {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const name = options.parcelName || "Parcela";
  doc.setFillColor(31, 73, 55);
  doc.rect(0, 0, 297, 18, "F");
  doc.setTextColor(250, 247, 238);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("AgRegen · Bitácora de campo", 14, 11);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`${name}  ·  ${new Date().toLocaleDateString("es-MX")}`, 283, 11, { align: "right" });
  doc.setTextColor(61, 72, 62);
  doc.setFontSize(9);
  doc.text(options.filters || "Todos los registros", 14, 27);
  if (options.summary) doc.text(options.summary, 283, 27, { align: "right" });
  autoTable(doc, {
    startY: 33,
    head: [["Fecha", "Actividad", "Estado", "Detalle", "Cantidades", "Costo"]],
    body: options.rows.map((row) => [row.date, row.activity, row.status, row.detail, row.quantities, row.cost]),
    styles: { fontSize: 8, cellPadding: 3, textColor: [48, 59, 49], lineColor: [216, 218, 204], lineWidth: 0.2 },
    headStyles: { fillColor: [73, 111, 78], textColor: [250, 247, 238], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [244, 242, 231] },
    margin: { left: 14, right: 14 },
  });
  doc.setFontSize(7);
  doc.setTextColor(112, 119, 104);
  doc.text("Exportación generada desde AgRegen · Las cantidades y monedas se mantienen separadas.", 14, 201);
  doc.save(`AgRegen_Bitacora_${safeName(name)}_${new Date().toISOString().slice(0, 10)}.pdf`);
}