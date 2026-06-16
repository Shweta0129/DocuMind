import jsPDF from "jspdf";

// Builds a structured PDF directly from the document object (not via canvas)
// so PDFs are crisp, selectable, and small.
export function exportDocumentToPDF(doc) {
  const pdf = new jsPDF({ unit: "pt", format: "letter" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 56;
  const contentW = pageW - margin * 2;
  let y = margin;

  const ensure = (delta) => {
    if (y + delta > pageH - margin) {
      pdf.addPage();
      y = margin;
    }
  };

  // Title
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(22);
  const titleLines = pdf.splitTextToSize(doc.title || "Untitled Document", contentW);
  titleLines.forEach((ln) => { ensure(26); pdf.text(ln, margin, y); y += 26; });

  // Meta
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.setTextColor(110);
  const meta = `${(doc.type || "").toUpperCase()}  ·  Quality ${doc.completeness_score ?? "—"}%  ·  ${new Date(doc.created_at || Date.now()).toLocaleString()}`;
  ensure(16); pdf.text(meta, margin, y); y += 18;
  pdf.setTextColor(20);

  // Separator
  ensure(10);
  pdf.setDrawColor(15);
  pdf.setLineWidth(1.2);
  pdf.line(margin, y, pageW - margin, y);
  y += 18;

  const writeWrapped = (text, opts = {}) => {
    const fontSize = opts.fontSize || 11;
    const bold = !!opts.bold;
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.setFontSize(fontSize);
    const lines = pdf.splitTextToSize(text, contentW - (opts.indent || 0));
    const lh = fontSize * 1.35;
    lines.forEach((ln) => {
      ensure(lh);
      pdf.text(ln, margin + (opts.indent || 0), y);
      y += lh;
    });
  };

  const renderMarkdownBlocks = (md) => {
    if (!md) return;
    const lines = md.split(/\r?\n/);
    let inList = false;
    lines.forEach((raw) => {
      let line = raw.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1");
      if (!line.trim()) { y += 4; inList = false; return; }
      // Heading inside section
      const h = /^(#{1,6})\s+(.+)$/.exec(line);
      if (h) {
        y += 4;
        writeWrapped(h[2], { fontSize: 13, bold: true });
        y += 2;
        return;
      }
      // List item
      const li = /^\s*[-*]\s+(.+)$/.exec(line) || /^\s*\d+\.\s+(.+)$/.exec(line);
      if (li) {
        ensure(15);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(11);
        pdf.text("•", margin + 4, y);
        const lines2 = pdf.splitTextToSize(li[1], contentW - 22);
        lines2.forEach((ln, idx) => {
          if (idx > 0) ensure(15);
          pdf.text(ln, margin + 18, y);
          y += 11 * 1.35;
        });
        inList = true;
        return;
      }
      // Pipe-table row → render as plain line
      writeWrapped(line, { fontSize: 11 });
    });
  };

  (doc.content?.sections || []).forEach((sec) => {
    y += 8;
    ensure(28);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(15);
    pdf.text(sec.heading || "Section", margin, y);
    y += 8;
    pdf.setDrawColor(220, 200, 60);
    pdf.setLineWidth(3);
    pdf.line(margin, y, margin + 38, y);
    y += 12;
    renderMarkdownBlocks(sec.content || "");
  });

  const safe = (doc.title || "document").replace(/[^a-z0-9-_]+/gi, "_").slice(0, 60);
  pdf.save(`${safe}.pdf`);
}
