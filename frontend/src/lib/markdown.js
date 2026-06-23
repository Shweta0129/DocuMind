// Tiny, dependency-free Markdown → HTML renderer tailored for DocuMind output.
// Handles: headings, bold, italics, inline code, links, ordered/unordered lists,
// blockquotes, simple GFM tables, and paragraphs.

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderInline(text) {
  let t = escapeHtml(text);
  // images (must run before links). Only allow data: and http(s): sources.
  t = t.replace(/!\[([^\]]*)\]\((data:image\/[^)]+|https?:\/\/[^)]+)\)/g,
    '<img alt="$1" src="$2" class="docu-img" />');
  // bold
  t = t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // italic
  t = t.replace(/(^|[^*])\*(?!\s)([^*]+?)\*(?!\*)/g, "$1<em>$2</em>");
  // inline code
  t = t.replace(/`([^`]+?)`/g, "<code>$1</code>");
  // links
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  return t;
}

function renderTable(lines) {
  const rows = lines.map(l => l.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim()));
  if (rows.length < 2) return "";
  const header = rows[0];
  const body = rows.slice(2); // skip separator row
  const thead = `<thead><tr>${header.map(h => `<th>${renderInline(h)}</th>`).join("")}</tr></thead>`;
  const tbody = `<tbody>${body
    .map(r => `<tr>${r.map(c => `<td>${renderInline(c)}</td>`).join("")}</tr>`)
    .join("")}</tbody>`;
  return `<table>${thead}${tbody}</table>`;
}

export function markdownToHtml(md) {
  if (!md) return "";
  const lines = md.split(/\r?\n/);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Fenced code blocks — ```mermaid becomes a renderable diagram node,
    // any other fenced block becomes a <pre><code> block.
    const fence = /^\s*```\s*([\w-]*)\s*$/.exec(line);
    if (fence) {
      const lang = (fence[1] || "").toLowerCase();
      const code = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      const raw = code.join("\n");
      if (lang === "mermaid") {
        // mermaid reads textContent; escaping is safe (entities decode back).
        out.push(`<div class="mermaid">${escapeHtml(raw)}</div>`);
      } else {
        out.push(`<pre class="code-block"><code>${escapeHtml(raw)}</code></pre>`);
      }
      continue;
    }

    // Headings
    const hMatch = /^(#{1,6})\s+(.+)$/.exec(line);
    if (hMatch) {
      const lvl = hMatch[1].length;
      out.push(`<h${lvl}>${renderInline(hMatch[2])}</h${lvl}>`);
      i++;
      continue;
    }

    // Tables — a row is any line containing "|"; the 2nd line must be a separator.
    // Rows may omit leading/trailing pipes (models often do), so we don't require them.
    const isSep = (s) => /-/.test(s) && /^\s*\|?[\s:|-]+\|?\s*$/.test(s);
    if (line.includes("|") && i + 1 < lines.length && isSep(lines[i + 1])) {
      const tableLines = [line, lines[i + 1]];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() && !/^\s*#{1,6}\s/.test(lines[i])) {
        tableLines.push(lines[i]);
        i++;
      }
      out.push(renderTable(tableLines));
      continue;
    }

    // Blockquote
    if (/^>\s?/.test(line)) {
      const block = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        block.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${renderInline(block.join(" "))}</blockquote>`);
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      out.push(`<ul>${items.map(it => `<li>${renderInline(it)}</li>`).join("")}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      out.push(`<ol>${items.map(it => `<li>${renderInline(it)}</li>`).join("")}</ol>`);
      continue;
    }

    // Blank line
    if (!line.trim()) { i++; continue; }

    // Paragraph (collect until blank)
    const para = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|>|\s*[-*]\s|\s*\d+\.\s|\s*\|)/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    out.push(`<p>${renderInline(para.join(" "))}</p>`);
  }
  return out.join("\n");
}
