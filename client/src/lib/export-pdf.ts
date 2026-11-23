import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import logoUrl from "../assets/logo-agregen.png";

const C = {
  darkGreen:   [22, 101, 52]   as [number, number, number],
  primaryGreen:[21, 128, 61]   as [number, number, number],
  lightGreen:  [240, 253, 244] as [number, number, number],
  softGreen:   [187, 247, 208] as [number, number, number],
  textDark:    [17, 24, 39]    as [number, number, number],
  textMuted:   [107, 114, 128] as [number, number, number],
  white:       [255, 255, 255] as [number, number, number],
  borderGray:  [229, 231, 235] as [number, number, number],
};

export interface PaperRef {
  title: string;
  authors: string;
  year: number | null;
  doi: string | null;
  url: string;
  citationCount: number;
}

export interface ExportPDFOptions {
  parcelName: string;
  crop: string;
  content: string;
  papers?: PaperRef[];
}

function stripInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[(.+?)\]\(.*?\)/g, "$1")
    .trim();
}

async function loadLogoJpeg(): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const TARGET_W = 400;
        const ratio = img.naturalHeight / img.naturalWidth;
        const canvas = document.createElement("canvas");
        canvas.width = TARGET_W;
        canvas.height = Math.round(TARGET_W * ratio);
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.92));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = logoUrl;
  });
}

function parseMarkdownTable(tableLines: string[]): { headers: string[]; rows: string[][] } | null {
  const meaningful = tableLines.filter(l => !/^\|[\s|:=-]+\|$/.test(l));
  if (meaningful.length < 2) return null;
  const parseRow = (line: string): string[] =>
    line.split("|").slice(1, -1).map(cell => stripInline(cell.trim()));
  return {
    headers: parseRow(meaningful[0]),
    rows: meaningful.slice(1).map(parseRow),
  };
}

export async function exportReportPDF(opts: ExportPDFOptions): Promise<void> {
  const { parcelName, crop, content, papers = [] } = opts;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  const PW = 210;
  const PH = 297;
  const ML = 18;
  const MR = 18;
  const CW = PW - ML - MR;
  const FOOTER_H = 14;
  const BOTTOM_LIMIT = PH - FOOTER_H - 4;

  const logoJpeg = await loadLogoJpeg();

  let page = 1;
  let y = 0;

  function setColor(rgb: [number, number, number]) { doc.setTextColor(rgb[0], rgb[1], rgb[2]); }
  function setFill(rgb: [number, number, number]) { doc.setFillColor(rgb[0], rgb[1], rgb[2]); }
  function setDraw(rgb: [number, number, number]) { doc.setDrawColor(rgb[0], rgb[1], rgb[2]); }

  function drawFooter(pageNum: number) {
    setDraw(C.borderGray);
    doc.setLineWidth(0.3);
    doc.line(ML, PH - FOOTER_H, PW - MR, PH - FOOTER_H);
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "normal");
    setColor(C.textMuted);
    doc.text("AgRegen 5.0 · Informe agronómico generado con IA · openalex.org", ML, PH - 6);
    doc.text(`${pageNum}`, PW - MR, PH - 6, { align: "right" });
  }

  function drawFirstPageHeader() {
    setFill(C.darkGreen);
    doc.rect(0, 0, PW, 10, "F");

    if (logoJpeg) {
      doc.addImage(logoJpeg, "JPEG", ML, 12, 40, 22);
    }

    const dateStr = new Date().toLocaleDateString("es-MX", {
      day: "numeric", month: "long", year: "numeric",
    });
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "normal");
    setColor(C.textMuted);
    doc.text(dateStr, PW - MR, 17, { align: "right" });
    doc.setFontSize(7);
    setColor(C.primaryGreen);
    doc.setFont("helvetica", "bold");
    doc.text("INFORME DE ANÁLISIS PROFUNDO", PW - MR, 23, { align: "right" });

    setDraw(C.softGreen);
    doc.setLineWidth(0.5);
    doc.line(ML, 37, PW - MR, 37);

    setFill(C.lightGreen);
    doc.roundedRect(ML, 39, CW, 10, 2, 2, "F");
    setFill(C.primaryGreen);
    doc.rect(ML, 39, 2.5, 10, "F");

    doc.setFontSize(8.5);
    doc.setFont("helvetica", "bold");
    setColor(C.darkGreen);
    doc.text(`${parcelName}`, ML + 6, 44.5);

    const nameW = doc.getTextWidth(`${parcelName}`);
    doc.setFont("helvetica", "normal");
    setColor(C.textMuted);
    doc.text(`· ${crop}`, ML + 9 + nameW, 44.5);

    y = 54;
  }

  function drawCompactHeader() {
    setFill(C.darkGreen);
    doc.rect(0, 0, PW, 25, "F");

    if (logoJpeg) {
      doc.addImage(logoJpeg, "JPEG", ML, 7, 26, 14);
    }
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    setColor(C.white);
    doc.text(`${parcelName} · ${crop}`, PW - MR, 17, { align: "right" });

    setDraw(C.softGreen);
    doc.setLineWidth(0.3);
    doc.line(ML, 26, PW - MR, 26);

    y = 31;
  }

  function addNewPage() {
    doc.addPage();
    page++;
    drawCompactHeader();
  }

  function checkBreak(needed: number) {
    if (y + needed > BOTTOM_LIMIT) addNewPage();
  }

  function renderParagraph(text: string, indent = 0) {
    const plain = stripInline(text);
    if (!plain) return;
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    setColor(C.textDark);
    const wrapped = doc.splitTextToSize(plain, CW - indent);
    checkBreak(wrapped.length * 5.2 + 3);
    doc.text(wrapped, ML + indent, y);
    y += wrapped.length * 5.2 + 3;
  }

  drawFirstPageHeader();
  drawFooter(1);

  const lines = content.split("\n");
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();
    i++;

    if (!line) { y += 1.5; continue; }

    if (line.startsWith("# ") && !line.startsWith("## ")) {
      const text = stripInline(line.slice(2));
      checkBreak(14);
      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      setColor(C.darkGreen);
      const wrapped = doc.splitTextToSize(text, CW);
      doc.text(wrapped, ML, y);
      y += wrapped.length * 8 + 4;
      continue;
    }

    if (line.startsWith("## ") && !line.startsWith("### ")) {
      const text = stripInline(line.slice(3));
      checkBreak(13);
      setFill(C.primaryGreen);
      doc.rect(ML, y - 5, CW, 10, "F");
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      setColor(C.white);
      doc.text(text.toUpperCase(), ML + 4, y + 1.5);
      y += 13;
      continue;
    }

    if (line.startsWith("### ") && !line.startsWith("#### ")) {
      const text = stripInline(line.slice(4));
      checkBreak(11);
      setFill(C.lightGreen);
      doc.rect(ML, y - 4, CW, 9, "F");
      doc.setFontSize(9.5);
      doc.setFont("helvetica", "bold");
      setColor(C.darkGreen);
      const wrapped = doc.splitTextToSize(text, CW - 4);
      doc.text(wrapped, ML + 3, y + 2);
      y += wrapped.length * 6 + 5;
      continue;
    }

    if (line.startsWith("#### ")) {
      const text = stripInline(line.slice(5));
      checkBreak(9);
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      setColor(C.textDark);
      const wrapped = doc.splitTextToSize(text, CW);
      doc.text(wrapped, ML, y);
      y += wrapped.length * 5.5 + 2;
      continue;
    }

    if (/^[-=]{3,}$/.test(line)) {
      checkBreak(5);
      setDraw(C.softGreen);
      doc.setLineWidth(0.4);
      doc.line(ML, y, PW - MR, y);
      y += 4;
      continue;
    }

    if (line.startsWith("> ")) {
      const text = stripInline(line.slice(2));
      const wrapped = doc.splitTextToSize(text, CW - 9);
      const boxH = wrapped.length * 5.2 + 6;
      checkBreak(boxH);
      setFill(C.lightGreen);
      doc.rect(ML, y - 3, CW, boxH, "F");
      setFill(C.primaryGreen);
      doc.rect(ML, y - 3, 2, boxH, "F");
      doc.setFontSize(8.5);
      doc.setFont("helvetica", "italic");
      setColor(C.darkGreen);
      doc.text(wrapped, ML + 6, y + 1);
      y += boxH + 2;
      continue;
    }

    if (line.startsWith("|")) {
      const tableLines = [line];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i].trim());
        i++;
      }
      const tableData = parseMarkdownTable(tableLines);
      if (tableData && tableData.rows.length > 0) {
        const estimatedH = (tableData.rows.length + 1) * 9 + 8;
        checkBreak(Math.min(estimatedH, 40));
        autoTable(doc, {
          startY: y,
          head: [tableData.headers],
          body: tableData.rows,
          styles: {
            fontSize: 7.5,
            cellPadding: { top: 2, right: 3, bottom: 2, left: 3 },
            overflow: "linebreak",
            lineColor: C.softGreen,
            lineWidth: 0.2,
          },
          headStyles: {
            fillColor: C.primaryGreen as [number, number, number],
            textColor: C.white as [number, number, number],
            fontStyle: "bold",
            fontSize: 7.5,
          },
          alternateRowStyles: {
            fillColor: C.lightGreen as [number, number, number],
          },
          bodyStyles: {
            textColor: C.textDark as [number, number, number],
          },
          columnStyles: Object.fromEntries(
            tableData.headers.map((_, idx) => [idx, { cellWidth: "auto" }])
          ),
          margin: { left: ML, right: MR },
          didDrawPage: (data: { pageNumber: number }) => {
            if (data.pageNumber > 1) {
              drawCompactHeader();
            }
            drawFooter(data.pageNumber);
          },
        });
        y = (doc as any).lastAutoTable.finalY + 5;
      }
      continue;
    }

    if (/^[-*•] /.test(line)) {
      const text = stripInline(line.replace(/^[-*•] /, ""));
      const wrapped = doc.splitTextToSize(text, CW - 8);
      checkBreak(wrapped.length * 5.2 + 2);
      setFill(C.primaryGreen);
      doc.ellipse(ML + 2, y - 1.2, 0.9, 0.9, "F");
      doc.setFontSize(8.5);
      doc.setFont("helvetica", "normal");
      setColor(C.textDark);
      doc.text(wrapped, ML + 6, y);
      y += wrapped.length * 5.2 + 2;
      continue;
    }

    if (/^  +[-*•] /.test(raw)) {
      const text = stripInline(raw.replace(/^.*[-*•] /, ""));
      const wrapped = doc.splitTextToSize(text, CW - 14);
      checkBreak(wrapped.length * 5 + 1.5);
      setFill(C.textMuted);
      doc.ellipse(ML + 8, y - 1, 0.6, 0.6, "F");
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      setColor(C.textMuted);
      doc.text(wrapped, ML + 11, y);
      y += wrapped.length * 5 + 1.5;
      continue;
    }

    const numMatch = line.match(/^(\d+)\.\s(.+)$/);
    if (numMatch) {
      const num = numMatch[1];
      const text = stripInline(numMatch[2]);
      const wrapped = doc.splitTextToSize(text, CW - 11);
      checkBreak(wrapped.length * 5.2 + 2);
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      setColor(C.primaryGreen);
      doc.text(`${num}.`, ML + 1, y);
      doc.setFont("helvetica", "normal");
      setColor(C.textDark);
      doc.text(wrapped, ML + 9, y);
      y += wrapped.length * 5.2 + 2;
      continue;
    }

    renderParagraph(line);
  }

  if (papers.length > 0) {
    checkBreak(20);
    setFill(C.primaryGreen);
    doc.rect(ML, y - 5, CW, 10, "F");
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    setColor(C.white);
    doc.text("BIBLIOGRAFÍA CIENTÍFICA (OPENALEX)", ML + 4, y + 1.5);
    y += 14;

    papers.forEach((p, idx) => {
      const extra = p.doi ? ` DOI: ${p.doi}` : p.url ? ` ${p.url}` : "";
      const lineText = stripInline(`${p.authors}${p.year ? ` (${p.year}).` : "."} ${p.title}${extra}`);
      const wrapped = doc.splitTextToSize(lineText, CW - 9);
      checkBreak(wrapped.length * 5 + 3);
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      setColor(C.primaryGreen);
      doc.text(`[${idx + 1}]`, ML + 1, y);
      doc.setFont("helvetica", "normal");
      setColor(C.textDark);
      doc.text(wrapped, ML + 8, y);
      y += wrapped.length * 5 + 3;
    });
  }

  const total = doc.getNumberOfPages();
  for (let p = 2; p <= total; p++) {
    doc.setPage(p);
    drawFooter(p);
  }
  doc.setPage(1);

  const safeName = parcelName.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ\s]/g, "_").trim();
  const dateTag = new Date().toISOString().slice(0, 10);
  doc.save(`AgRegen_Informe_${safeName}_${dateTag}.pdf`);
}
