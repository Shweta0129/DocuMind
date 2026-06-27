import { useEffect, useRef, useState } from "react";
import { api, apiError } from "../lib/api";
import { FileSearch, Upload, Trash2, ShieldCheck, AlertTriangle, FileText, Sparkles } from "lucide-react";
import { toast } from "sonner";

export default function Reviewer() {
  const [reviews, setReviews] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [active, setActive] = useState(null);
  const fileRef = useRef(null);

  const load = () => api.listReviews().then(setReviews).catch(() => {});

  useEffect(() => { load(); }, []);

  const onUpload = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const r = await api.reviewUpload(file);
      toast.success("Document reviewed");
      setActive(r);
      load();
    } catch (e) {
      toast.error(apiError(e, "Upload / analysis failed"));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const onDelete = async (id) => {
    await api.deleteReview(id);
    setReviews((r) => r.filter((x) => x.id !== id));
    if (active?.id === id) setActive(null);
    toast.success("Review removed");
  };

  return (
    <div className="px-5 md:px-10 py-8 md:py-12 max-w-7xl mx-auto" data-testid="reviewer-page">
      <div className="flex items-end justify-between gap-4 mb-6">
        <div>
          <div className="label-eyebrow flex items-center gap-1.5"><FileSearch className="w-3.5 h-3.5" /> Reviewer</div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight" style={{ fontFamily: "Outfit" }}>
            Upload a document. Get an instant review.
          </h1>
          <p className="text-sm text-[var(--muted)] mt-2">
            Drop a PDF or DOCX (BRD, SOP, test plan, policy…). Claude will score
            completeness, list strengths and weaknesses, identify missing sections,
            and recommend improvements.
          </p>
        </div>
      </div>

      {/* Upload area */}
      <div
        className="nb-card p-6 md:p-8 mb-8 text-center relative overflow-hidden"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files?.[0];
          if (file) onUpload(file);
        }}
        data-testid="reviewer-upload-card"
      >
        <div aria-hidden className="absolute -top-8 -right-8 w-32 h-32 rounded-full border-2 border-[var(--ink)] bg-[var(--secondary)] opacity-80" />
        <div className="relative z-10">
          <div className="w-14 h-14 rounded-2xl bg-[var(--primary)] border-2 border-[var(--ink)] shadow-[3px_3px_0_0_var(--ink)] flex items-center justify-center mx-auto">
            <Upload className="w-6 h-6" strokeWidth={2.5} />
          </div>
          <h3 className="text-xl font-black mt-3" style={{ fontFamily: "Outfit" }}>
            Drop file here, or pick one
          </h3>
          <p className="text-sm text-[var(--muted)] mt-1">PDF, DOCX, TXT or MD — up to a few MB</p>

          <div className="flex items-center justify-center gap-2 mt-5">
            <button className="nb-btn" onClick={() => fileRef.current?.click()} disabled={uploading} data-testid="reviewer-pick-file-btn">
              <Upload className="w-4 h-4" /> {uploading ? "Analyzing…" : "Choose file"}
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx,.txt,.md"
            hidden
            onChange={(e) => onUpload(e.target.files?.[0])}
            data-testid="reviewer-file-input"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Previous reviews */}
        <div className="lg:col-span-2">
          <div className="label-eyebrow mb-2">Past reviews</div>
          <div className="space-y-3">
            {reviews.length === 0 && <div className="text-sm text-[var(--muted)]">No reviews yet.</div>}
            {reviews.map((r) => (
              <div
                key={r.id}
                className={`nb-card p-4 cursor-pointer ${active?.id === r.id ? "ring-2 ring-[var(--primary)]" : ""}`}
                onClick={() => setActive(r)}
                data-testid={`review-item-${r.id}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-bold truncate" style={{ fontFamily: "Outfit" }}>{r.filename}</div>
                    <div className="text-xs text-[var(--muted)] mt-0.5">
                      {(r.analysis?.doc_type_guess) || "Document"} · Quality {r.analysis?.quality_score ?? "—"}%
                    </div>
                    <div className="text-[10px] text-[var(--muted)] mt-1">
                      {new Date(r.created_at).toLocaleString()}
                    </div>
                  </div>
                  <button
                    className="nb-btn nb-btn-ghost !px-2 !py-1"
                    onClick={(e) => { e.stopPropagation(); onDelete(r.id); }}
                    aria-label="Delete"
                    data-testid={`review-delete-${r.id}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Active review detail */}
        <div className="lg:col-span-3">
          {!active ? (
            <div className="nb-card p-6 text-sm text-[var(--muted)]" data-testid="review-empty">
              Pick a previous review on the left, or upload a new document above.
            </div>
          ) : (
            <ReviewDetail review={active} />
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewDetail({ review }) {
  const a = review.analysis || {};
  return (
    <div className="space-y-4" data-testid="review-detail">
      <div className="nb-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="label-eyebrow flex items-center gap-1.5"><FileText className="w-3 h-3" /> {a.doc_type_guess || "Document"}</div>
            <h3 className="text-xl font-black mt-1" style={{ fontFamily: "Outfit" }}>{review.filename}</h3>
            <p className="text-sm text-[var(--muted)] mt-1">{a.summary}</p>
          </div>
          <div className="text-right">
            <div className="text-4xl font-black" style={{ fontFamily: "Outfit" }} data-testid="review-quality-score">{a.quality_score ?? "—"}%</div>
            <div className="label-eyebrow">Quality score</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Panel icon={ShieldCheck} title="Strengths" items={a.strengths || []} accent="var(--mint)" testid="review-strengths" />
        <Panel icon={AlertTriangle} title="Weaknesses" items={a.weaknesses || []} accent="#FFB6C1" testid="review-weaknesses" />
        <Panel icon={FileText} title="Missing sections" items={a.missing_sections || []} accent="#FFD3B6" testid="review-missing" />
        <Panel icon={AlertTriangle} title="Clarity issues" items={a.clarity_issues || []} accent="#FFE0B2" testid="review-clarity" />
        <Panel icon={AlertTriangle} title="Risks" items={a.risks || []} accent="#D1C4E9" testid="review-risks" />
        <Panel icon={Sparkles} title="Recommendations" items={a.recommendations || []} accent="var(--primary)" testid="review-recommendations" />
      </div>
    </div>
  );
}

function Panel({ icon: Icon, title, items, accent, testid }) {
  return (
    <div className="nb-card p-4" data-testid={testid}>
      <div className="flex items-center gap-2 mb-2">
        <span className="w-7 h-7 rounded-md border-2 border-[var(--ink)] flex items-center justify-center" style={{ background: accent }}>
          <Icon className="w-3.5 h-3.5" strokeWidth={2.5} />
        </span>
        <h4 className="font-bold" style={{ fontFamily: "Outfit" }}>{title}</h4>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-[var(--muted)]">None found.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {items.map((s, i) => <li key={i} className="leading-snug">› {s}</li>)}
        </ul>
      )}
    </div>
  );
}
