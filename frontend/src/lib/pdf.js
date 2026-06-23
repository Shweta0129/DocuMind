import jsPDF from "jspdf";
import mermaid from "mermaid";

let _mermaidReady = false;
function ensureMermaid() {
  if (_mermaidReady) return;
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral" });
  _mermaidReady = true;
}

// Render an SVG string to a PNG data-URL via an offscreen canvas.
function svgToPng(svg) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const w = img.width || 700;
      const h = img.height || 420;
      const canvas = document.createElement("canvas");
      canvas.width = w * scale;
      canvas.height = h * scale;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = reject;
    img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
  });
}

// Pre-render every ```mermaid block (in document order) to a PNG data-URL.
async function prerenderDiagrams(doc) {
  ensureMermaid();
  const codes = [];
  (doc.content?.sections || []).forEach((sec) => {
    const lines = (sec.content || "").split(/\r?\n/);
    let i = 0;
    while (i < lines.length) {
      if (/^\s*```\s*mermaid\s*$/i.test(lines[i])) {
        i++;
        const c = [];
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { c.push(lines[i]); i++; }
        i++;
        codes.push(c.join("\n"));
      } else { i++; }
    }
  });
  const out = [];
  for (let k = 0; k < codes.length; k++) {
    try {
      const { svg } = await mermaid.render(`pdf-mmd-${Date.now()}-${k}`, codes[k]);
      out.push(await svgToPng(svg));
    } catch { out.push(null); }
  }
  return out;
}

// Builds a structured PDF directly from the document object (not via canvas)
// so PDFs are crisp, selectable, and small. Renders real tables, embedded
// (user) images, rendered Mermaid diagrams, and a Document Control block.
export async function exportDocumentToPDF(doc, settings = null) {
  const diagramImages = await prerenderDiagrams(doc);
  let diagramIdx = 0;
  const pdf = new jsPDF({ unit: "pt", format: "letter" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 56;
  const contentW = pageW - margin * 2;
  let y = margin;

  const ensure = (delta) => {
    if (y + delta > pageH - margin) { pdf.addPage(); y = margin; }
  };

  const writeWrapped = (text, opts = {}) => {
    const fontSize = opts.fontSize || 11;
    pdf.setFont("helvetica", opts.bold ? "bold" : "normal");
    pdf.setFontSize(fontSize);
    if (opts.color) pdf.setTextColor(opts.color); else pdf.setTextColor(20);
    const lines = pdf.splitTextToSize(text, contentW - (opts.indent || 0));
    const lh = fontSize * 1.35;
    lines.forEach((ln) => { ensure(lh); pdf.text(ln, margin + (opts.indent || 0), y); y += lh; });
  };

  // ---- Title ----
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(22); pdf.setTextColor(15);
  pdf.splitTextToSize(doc.title || "Untitled Document", contentW).forEach((ln) => {
    ensure(26); pdf.text(ln, margin, y); y += 26;
  });

  // ---- Meta ----
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(10); pdf.setTextColor(110);
  ensure(16);
  pdf.text(`${(doc.type || "").toUpperCase()}   -   Quality ${doc.completeness_score ?? "-"}%   -   v${doc.version_number || "1.0"}`, margin, y);
  y += 18;

  // ---- Separator ----
  pdf.setDrawColor(15); pdf.setLineWidth(1.2);
  ensure(10); pdf.line(margin, y, pageW - margin, y); y += 16;

  // ---- Document Control ----
  if (settings) {
    const props = [
      ["Company", settings.company_name], ["Project", settings.project_name],
      ["Document ID", settings.document_id],
      ["Version", `v${settings.version_number || doc.version_number || "1.0"}`],
      ["Author", settings.author], ["Reviewer", settings.reviewer], ["Approver", settings.approver],
    ].filter(([, v]) => v);
    if (props.length) {
      writeWrapped("Document Control", { fontSize: 12, bold: true });
      y += 2;
      props.forEach(([k, v]) => writeWrapped(`${k}:  ${v}`, { fontSize: 10, indent: 6 }));
      y += 6;
      pdf.setDrawColor(200); pdf.setLineWidth(0.6); ensure(8); pdf.line(margin, y, pageW - margin, y); y += 14;
    }
  }

  const stripInline = (s) => s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1");

  const drawTable = (rows) => {
    if (rows.length < 1) return;
    const header = rows[0];
    const body = rows.slice(2); // skip separator
    const cols = header.length;
    const colW = contentW / cols;
    const pad = 5;

    const drawRow = (cells, isHeader) => {
      pdf.setFont("helvetica", isHeader ? "bold" : "normal");
      pdf.setFontSize(9.5);
      const cellLines = cells.map((c) => pdf.splitTextToSize(stripInline(c || ""), colW - pad * 2));
      const rowH = Math.max(...cellLines.map((l) => l.length)) * 12 + pad * 2;
      ensure(rowH);
      for (let c = 0; c < cols; c++) {
        const x = margin + c * colW;
        if (isHeader) { pdf.setFillColor(255, 240, 170); pdf.rect(x, y, colW, rowH, "F"); }
        pdf.setDrawColor(15); pdf.setLineWidth(0.7); pdf.rect(x, y, colW, rowH);
        pdf.setTextColor(20);
        (cellLines[c] || []).forEach((ln, li) => pdf.text(ln, x + pad, y + pad + 9 + li * 12));
      }
      y += rowH;
    };

    drawRow(header, true);
    body.forEach((r) => {
      const cells = [...r];
      while (cells.length < cols) cells.push("");
      drawRow(cells, false);
    });
    y += 8;
  };

  const addImage = (dataUrl) => {
    try {
      const props = pdf.getImageProperties(dataUrl);
      const drawW = Math.min(contentW, props.width);
      const drawH = drawW * (props.height / props.width);
      ensure(drawH + 8);
      pdf.addImage(dataUrl, props.fileType || "PNG", margin, y, drawW, drawH);
      y += drawH + 8;
    } catch { /* skip unsupported image */ }
  };

  const renderBlocks = (md) => {
    if (!md) return;
    const lines = md.split(/\r?\n/);
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      // fenced block
      const fence = /^\s*```\s*([\w-]*)\s*$/.exec(line);
      if (fence) {
        const lang = (fence[1] || "").toLowerCase();
        i++;
        const code = [];
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { code.push(lines[i]); i++; }
        i++;
        if (lang === "mermaid") {
          const dimg = diagramImages[diagramIdx++];
          if (dimg) addImage(dimg);
          else writeWrapped("[ Diagram ]", { fontSize: 9, color: 110 });
        } else {
          pdf.setFont("courier", "normal"); pdf.setFontSize(9); pdf.setTextColor(40);
          code.forEach((cl) => { ensure(12); pdf.text(cl, margin + 6, y); y += 12; });
          pdf.setFont("helvetica", "normal");
        }
        y += 4;
        continue;
      }

      // data-URI image on its own line
      const img = /^\s*!\[[^\]]*\]\(\s*(data:image\/[^)]+)\)\s*$/.exec(line);
      if (img) { addImage(img[1]); i++; continue; }

      // table — a row is any line containing "|"; the 2nd line must be a separator.
      // (Rows may omit leading/trailing pipes, which models often do.)
      const isSep = (s) => /-/.test(s) && /^\s*\|?[\s:|-]+\|?\s*$/.test(s);
      if (line.includes("|") && i + 1 < lines.length && isSep(lines[i + 1])) {
        const tbl = [line, lines[i + 1]]; i += 2;
        while (i < lines.length && lines[i].includes("|") && lines[i].trim() && !/^\s*#{1,6}\s/.test(lines[i])) {
          tbl.push(lines[i]); i++;
        }
        const rows = tbl.map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
        drawTable(rows);
        continue;
      }

      if (!line.trim()) { y += 4; i++; continue; }

      // heading inside section
      const h = /^(#{1,6})\s+(.+)$/.exec(line);
      if (h) { y += 4; writeWrapped(h[2], { fontSize: 13, bold: true }); y += 2; i++; continue; }

      // list item
      const li = /^\s*[-*]\s+(.+)$/.exec(line) || /^\s*\d+\.\s+(.+)$/.exec(line);
      if (li) {
        ensure(15); pdf.setFont("helvetica", "normal"); pdf.setFontSize(11); pdf.setTextColor(20);
        pdf.text("-", margin + 4, y);
        pdf.splitTextToSize(stripInline(li[1]), contentW - 22).forEach((ln, idx) => {
          if (idx > 0) ensure(15); pdf.text(ln, margin + 18, y); y += 11 * 1.35;
        });
        i++; continue;
      }

      writeWrapped(stripInline(line), { fontSize: 11 });
      i++;
    }
  };

  (doc.content?.sections || []).forEach((sec) => {
    y += 8; ensure(28);
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(15); pdf.setTextColor(15);
    pdf.text(sec.heading || "Section", margin, y); y += 8;
    pdf.setDrawColor(220, 200, 60); pdf.setLineWidth(3);
    pdf.line(margin, y, margin + 38, y); y += 12;
    renderBlocks(sec.content || "");
  });

  const safe = (doc.title || "document").replace(/[^a-z0-9-_]+/gi, "_").slice(0, 60);
  pdf.save(`${safe}.pdf`);
}
