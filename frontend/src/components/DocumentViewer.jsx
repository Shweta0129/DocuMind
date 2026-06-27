import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { markdownToHtml } from "../lib/markdown";
import { exportDocumentToPDF } from "../lib/pdf";
import { api, apiError } from "../lib/api";
import { useCatalog, iconForName } from "../lib/catalog";
import { toast } from "sonner";
import {
  Copy, Download, Pencil, RotateCcw, Check, X, Save, Wand2,
  GitBranch, FileText, ChevronRight, History as HistoryIcon, FileDown, Image as ImageIcon,
} from "lucide-react";
import mermaid from "mermaid";
import { renderSectionsWithDiagrams } from "../lib/diagrams";

let _mermaidReady = false;
function ensureMermaid() {
  if (_mermaidReady) return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "neutral",
    flowchart: { useMaxWidth: true },
  });
  _mermaidReady = true;
}

export default function DocumentViewer({ doc, onUpdate, onRegenerate, regenerating, onAfterAction }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [copied, setCopied] = useState(false);
  const [improvingIdx, setImprovingIdx] = useState(-1);
  const [showPipeline, setShowPipeline] = useState(false);
  const [versions, setVersions] = useState([]);
  const [showVersions, setShowVersions] = useState(false);
  const [settings, setSettings] = useState(null);
  const viewerRef = useRef(null);
  const navigate = useNavigate();
  const { pipeline, byKey } = useCatalog();

  const pipelineTargets = pipeline?.[doc.type] || [];

  useEffect(() => {
    if (showVersions) {
      api.listVersions(doc.id).then(setVersions).catch(() => {});
    }
  }, [showVersions, doc.id]);

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => {});
  }, []);

  const insertImage = (sectionIdx, file) => {
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { toast.error("Image too large (max 3 MB)"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      setDraft((d) => ({
        ...d,
        sections: d.sections.map((s, idx) =>
          idx === sectionIdx ? { ...s, content: `${s.content || ""}\n\n![image](${dataUrl})\n` } : s),
      }));
      toast.success("Image inserted — Save to keep it");
    };
    reader.readAsDataURL(file);
  };

  // Render any Mermaid diagrams in the document body after content updates.
  useEffect(() => {
    if (editing) return;
    const el = viewerRef.current;
    if (!el) return;
    ensureMermaid();
    const nodes = el.querySelectorAll('.mermaid:not([data-processed="true"])');
    if (nodes.length) {
      mermaid.run({ nodes }).catch(() => {});
    }
  }, [doc?.id, doc?.updated_at, editing]);

  const startEdit = () => {
    setDraft({
      title: doc.title,
      sections: (doc.content?.sections || []).map((s) => ({ ...s })),
    });
    setEditing(true);
  };
  const cancelEdit = () => { setDraft(null); setEditing(false); };
  const saveEdit = async () => {
    await onUpdate({ title: draft.title, content: { sections: draft.sections } });
    setEditing(false); setDraft(null);
    toast.success("Document updated");
  };

  const handleCopy = async () => {
    const plain = [doc.title, "",
      ...(doc.content?.sections || []).map((s) => `## ${s.heading}\n${s.content}`)].join("\n\n");
    try {
      await navigator.clipboard.writeText(plain);
      setCopied(true); toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 1800);
    } catch { toast.error("Could not copy"); }
  };

  const handlePdf = async () => {
    try {
      await exportDocumentToPDF(doc, settings);
      toast.success("PDF download started");
    } catch {
      toast.error("Could not export PDF");
    }
  };
  const handleDocx = async () => {
    try {
      const sections = await renderSectionsWithDiagrams(doc.content?.sections || []);
      await api.downloadDocx(doc.id, { sections });
      toast.success("DOCX download started");
    } catch {
      toast.error("Could not export DOCX");
    }
  };

  const improve = async (idx) => {
    setImprovingIdx(idx);
    try {
      const updated = await api.improveSection(doc.id, idx);
      onAfterAction?.(updated);
      toast.success("Section improved");
    } catch { toast.error("Could not improve section"); }
    finally { setImprovingIdx(-1); }
  };

  const newVersion = async () => {
    try {
      const v = await api.createNewVersion(doc.id);
      toast.success(`New version v${v.version_number} created`);
      navigate(`/document/${v.id}`);
    } catch { toast.error("Could not create new version"); }
  };

  const runPipeline = async (target) => {
    toast.info(`Generating ${byKey[target]?.label || target}…`);
    try {
      const out = await api.pipelineGenerate(doc.id, target, doc.industry);
      toast.success("Generated downstream document");
      navigate(`/document/${out.id}`);
    } catch (e) { toast.error(apiError(e, "Pipeline generation failed")); }
  };

  return (
    <div className="nb-card p-5 md:p-8" data-testid="document-viewer">
      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-2 mb-5 pb-5 border-b-2 border-dashed border-[var(--ink)]">
        {!editing ? (
          <>
            <button className="nb-btn" onClick={handleCopy} data-testid="copy-document-btn">
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? "Copied" : "Copy"}
            </button>
            <button className="nb-btn nb-btn-ghost" onClick={handlePdf} data-testid="download-pdf-btn">
              <Download className="w-4 h-4" />
              PDF
            </button>
            <button className="nb-btn nb-btn-ghost" onClick={handleDocx} data-testid="download-docx-btn">
              <FileDown className="w-4 h-4" />
              DOCX
            </button>
            <button className="nb-btn nb-btn-ghost" onClick={startEdit} data-testid="edit-document-btn">
              <Pencil className="w-4 h-4" />
              Edit
            </button>
            <button className="nb-btn nb-btn-ghost" onClick={() => (onRegenerate ? onRegenerate() : newVersion())} disabled={regenerating} data-testid="regenerate-document-btn">
              <RotateCcw className={`w-4 h-4 ${regenerating ? "animate-spin" : ""}`} />
              {regenerating ? "Regenerating…" : "Regenerate"}
            </button>
            <button className="nb-btn nb-btn-ghost" onClick={newVersion} data-testid="new-version-btn">
              <HistoryIcon className="w-4 h-4" /> New version
            </button>
            <button className="nb-btn nb-btn-ghost" onClick={() => setShowVersions((v) => !v)} data-testid="show-versions-btn">
              <FileText className="w-4 h-4" /> Versions
            </button>
            {pipelineTargets.length > 0 && (
              <button className="nb-btn nb-btn-ghost" onClick={() => setShowPipeline((v) => !v)} data-testid="pipeline-toggle-btn">
                <GitBranch className="w-4 h-4" /> Pipeline
              </button>
            )}
          </>
        ) : (
          <>
            <button className="nb-btn" onClick={saveEdit} data-testid="save-edit-btn">
              <Save className="w-4 h-4" /> Save
            </button>
            <button className="nb-btn nb-btn-ghost" onClick={cancelEdit} data-testid="cancel-edit-btn">
              <X className="w-4 h-4" /> Cancel
            </button>
          </>
        )}
      </div>

      {/* Pipeline panel */}
      {showPipeline && pipelineTargets.length > 0 && (
        <div className="mb-5 border-2 border-[var(--ink)] rounded-lg p-3 bg-[var(--paper)]" data-testid="pipeline-panel">
          <div className="label-eyebrow mb-2">Generate downstream document</div>
          <div className="flex flex-wrap gap-2">
            {pipelineTargets.map((t) => {
              const meta = byKey[t];
              if (!meta) return null;
              const Icon = iconForName(meta.icon);
              return (
                <button
                  key={t}
                  className="nb-btn nb-btn-ghost"
                  style={{ background: meta.accent }}
                  onClick={() => runPipeline(t)}
                  data-testid={`pipeline-target-${t}`}
                >
                  <Icon className="w-4 h-4" /> {meta.label.replace(" Generator", "")} <ChevronRight className="w-3 h-3" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Versions panel */}
      {showVersions && (
        <div className="mb-5 border-2 border-[var(--ink)] rounded-lg p-3 bg-[var(--paper)]" data-testid="versions-panel">
          <div className="label-eyebrow mb-2">Versions</div>
          {versions.length === 0 ? (
            <div className="text-xs text-[var(--muted)]">No version data.</div>
          ) : (
            <ul className="space-y-1.5">
              {versions.map((v) => (
                <li key={v.id} className="flex items-center justify-between text-sm">
                  <button
                    className="text-left hover:underline"
                    onClick={() => navigate(`/document/${v.id}`)}
                    data-testid={`version-open-${v.id}`}
                  >
                    <span className="font-bold">v{v.version_number}</span> — {v.title}
                  </button>
                  <span className="text-xs text-[var(--muted)]">{new Date(v.created_at).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Title */}
      {editing ? (
        <input
          className="nb-input text-2xl md:text-3xl font-black mb-6"
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          data-testid="edit-title-input"
        />
      ) : (
        <>
          <h1
            className="text-2xl md:text-4xl font-black tracking-tight mb-2"
            style={{ fontFamily: "Outfit" }}
            data-testid="document-title"
          >
            {doc.title}
          </h1>
          <div className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--muted)] mb-6 flex flex-wrap items-center gap-2">
            <span>{doc.type?.replace("-", " ")}</span>
            <span>·</span>
            <span>v{doc.version_number || "1.0"}</span>
            {doc.industry && <><span>·</span><span>{doc.industry}</span></>}
            <span>·</span>
            <span>Created {new Date(doc.created_at).toLocaleString()}</span>
          </div>
        </>
      )}

      {/* Document Control (company header/footer info + sign-off) */}
      {!editing && settings && (settings.company_name || settings.author || settings.reviewer || settings.approver || settings.document_id || settings.project_name) && (
        <div className="nb-card p-4 mb-6 bg-[var(--paper)]" data-testid="document-control">
          <div className="flex items-center justify-between mb-2">
            <div className="label-eyebrow">Document Control</div>
            {settings.company_logo_url && (
              <img src={settings.company_logo_url} alt="company logo" className="h-8 object-contain" />
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2 text-sm">
            {[
              ["Company", settings.company_name],
              ["Project", settings.project_name],
              ["Document ID", settings.document_id],
              ["Version", `v${settings.version_number || doc.version_number || "1.0"}`],
              ["Author", settings.author],
              ["Reviewer", settings.reviewer],
              ["Approver", settings.approver],
            ].filter(([, v]) => v).map(([k, v]) => (
              <div key={k}>
                <span className="text-[var(--muted)] uppercase text-[10px] tracking-wider block">{k}</span>
                <span className="font-semibold">{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sections */}
      <div ref={viewerRef} className="docu-prose">
        {(editing ? draft.sections : doc.content?.sections || []).map((sec, i) => (
          <section key={i} className="mb-7 last:mb-0" data-testid={`document-section-${i}`}>
            {editing ? (
              <>
                <input
                  className="nb-input font-bold mb-2"
                  value={sec.heading}
                  onChange={(e) => {
                    const next = [...draft.sections];
                    next[i] = { ...next[i], heading: e.target.value };
                    setDraft({ ...draft, sections: next });
                  }}
                  data-testid={`edit-section-heading-${i}`}
                />
                <textarea
                  className="nb-input min-h-[160px] font-mono text-sm"
                  value={sec.content}
                  onChange={(e) => {
                    const next = [...draft.sections];
                    next[i] = { ...next[i], content: e.target.value };
                    setDraft({ ...draft, sections: next });
                  }}
                  data-testid={`edit-section-content-${i}`}
                />
                <label className="nb-chip cursor-pointer mt-2 inline-flex" data-testid={`insert-image-${i}`}>
                  <ImageIcon className="w-3 h-3" /> Insert image
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => { insertImage(i, e.target.files?.[0]); e.target.value = ""; }}
                  />
                </label>
              </>
            ) : (
              <>
                <div className="flex items-end justify-between gap-2 mb-3">
                  <h2
                    className="text-xl md:text-2xl font-bold pb-1 border-b-2 border-[var(--ink)] inline-block"
                    style={{ fontFamily: "Outfit" }}
                  >
                    {sec.heading}
                  </h2>
                  <button
                    className="nb-chip"
                    style={{ background: "var(--secondary)" }}
                    onClick={() => improve(i)}
                    disabled={improvingIdx === i}
                    data-testid={`improve-section-${i}`}
                    title="AI-improve this section"
                  >
                    <Wand2 className="w-3 h-3" /> {improvingIdx === i ? "Improving…" : "Improve"}
                  </button>
                </div>
                <div
                  className="docu-prose"
                  // eslint-disable-next-line react/no-danger
                  dangerouslySetInnerHTML={{ __html: markdownToHtml(sec.content || "") }}
                />
              </>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
