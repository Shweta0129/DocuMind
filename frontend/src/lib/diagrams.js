import mermaid from "mermaid";

let _ready = false;
function ensure() {
  if (_ready) return;
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral" });
  _ready = true;
}

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

/**
 * Return a copy of `sections` where every ```mermaid block is replaced by a
 * rendered PNG image markdown (![diagram](data-URI)), so server-side DOCX export
 * can embed the diagram as a picture. Diagrams that fail to render are dropped.
 */
export async function renderSectionsWithDiagrams(sections) {
  ensure();
  const out = [];
  for (let s = 0; s < (sections || []).length; s++) {
    const sec = sections[s];
    const lines = (sec.content || "").split(/\r?\n/);
    const result = [];
    let i = 0;
    let k = 0;
    while (i < lines.length) {
      if (/^\s*```\s*mermaid\s*$/i.test(lines[i])) {
        i++;
        const code = [];
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { code.push(lines[i]); i++; }
        i++;
        try {
          const { svg } = await mermaid.render(`docx-mmd-${Date.now()}-${s}-${k++}`, code.join("\n"));
          const png = await svgToPng(svg);
          result.push(`![diagram](${png})`);
        } catch {
          /* skip unrenderable diagram */
        }
      } else {
        result.push(lines[i]);
        i++;
      }
    }
    out.push({ ...sec, content: result.join("\n") });
  }
  return out;
}
