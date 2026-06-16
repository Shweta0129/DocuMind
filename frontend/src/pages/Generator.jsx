import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useCatalog, iconForName } from "../lib/catalog";
import DocumentViewer from "../components/DocumentViewer";
import QualityScore from "../components/QualityScore";
import GeneratingState from "../components/GeneratingState";
import InterviewPanel from "../components/InterviewPanel";
import { toast } from "sonner";
import { ArrowLeft, Sparkles, MessagesSquare, ListFilter, Gauge } from "lucide-react";

const FORM_MODE = "form";
const INTERVIEW_MODE = "interview";

export default function Generator() {
  const { type } = useParams();
  const navigate = useNavigate();
  const { byKey, industries, loading: catLoading } = useCatalog();
  const config = byKey[type];

  const [mode, setMode] = useState(FORM_MODE);
  const [industry, setIndustry] = useState("");
  const [values, setValues] = useState({});
  const [doc, setDoc] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState(null);

  useEffect(() => {
    if (!config) return;
    const initial = {};
    config.fields.forEach((f) => { initial[f.name] = ""; });
    // Auto-populate Industry field if it's part of inputs and user-selected industry exists
    setValues(initial);
    setDoc(null);
    setCheck(null);
  }, [type, config]);

  const requiredOk = useMemo(() => {
    if (!config) return false;
    return config.fields.filter((f) => f.required).every((f) => (values[f.name] || "").trim().length > 0);
  }, [config, values]);

  if (catLoading) return <div className="p-10"><div className="h-10 w-1/3 shimmer rounded-md mb-4" /><div className="h-60 shimmer rounded-xl" /></div>;
  if (!config) return (
    <div className="p-10">
      <p>Unknown generator type.</p>
      <Link to="/" className="nb-btn mt-4 inline-flex"><ArrowLeft className="w-4 h-4" /> Back</Link>
    </div>
  );

  const Icon = iconForName(config.icon);

  const runCompleteness = async () => {
    setChecking(true);
    setCheck(null);
    try {
      const out = await api.completeness({ type, inputs: values, industry });
      setCheck(out);
      toast.success(`Completeness: ${out.completeness_score}%`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not check completeness");
    } finally {
      setChecking(false);
    }
  };

  const generateFromForm = async () => {
    if (!requiredOk) {
      toast.error("Please fill required fields");
      return;
    }
    setGenerating(true);
    setDoc(null);
    try {
      const result = await api.generate({ type, inputs: values, industry });
      setDoc(result);
      toast.success("Document generated");
    } catch (e) {
      console.error(e);
      toast.error(e?.response?.data?.detail || "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const generateFromInterview = async (convo) => {
    setGenerating(true);
    setDoc(null);
    try {
      const result = await api.interviewGenerate(convo.id);
      setDoc(result);
      toast.success("Document generated from interview");
    } catch (e) {
      toast.error("Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const updateDoc = async (patch) => {
    const updated = await api.updateDocument(doc.id, patch);
    setDoc(updated);
  };

  return (
    <div className="px-5 md:px-10 py-8 md:py-10 max-w-7xl mx-auto" data-testid={`generator-${type}`}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate("/")} className="nb-btn nb-btn-ghost !px-3 !py-2" data-testid="back-to-dashboard">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div
            className="w-12 h-12 rounded-xl border-2 border-[var(--ink)] flex items-center justify-center shadow-[3px_3px_0_0_var(--ink)]"
            style={{ background: config.accent }}
          >
            <Icon className="w-6 h-6" strokeWidth={2.5} />
          </div>
          <div>
            <div className="label-eyebrow">{config.tag}</div>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight" style={{ fontFamily: "Outfit" }}>
              {config.label}
            </h1>
          </div>
        </div>

        {/* Industry selector */}
        <div className="flex items-center gap-2">
          <label className="label-eyebrow">Industry</label>
          <select
            className="nb-input !py-2 !w-44"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            data-testid="industry-selector"
          >
            <option value="">General</option>
            {industries.map((i) => (<option key={i} value={i}>{i}</option>))}
          </select>
        </div>
      </div>

      {/* Mode toggle */}
      <div className="flex items-center gap-2 mb-6" data-testid="mode-toggle">
        <button
          className={`nb-chip ${mode === FORM_MODE ? "" : "!bg-[var(--surface)]"}`}
          style={mode === FORM_MODE ? { background: "var(--primary)" } : {}}
          onClick={() => setMode(FORM_MODE)}
          data-testid="mode-form-btn"
        >
          <ListFilter className="w-3 h-3" /> Quick Form
        </button>
        <button
          className={`nb-chip ${mode === INTERVIEW_MODE ? "" : "!bg-[var(--surface)]"}`}
          style={mode === INTERVIEW_MODE ? { background: "var(--secondary)" } : {}}
          onClick={() => setMode(INTERVIEW_MODE)}
          data-testid="mode-interview-btn"
        >
          <MessagesSquare className="w-3 h-3" /> AI Interview
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 md:gap-8">
        {/* Left column: form OR interview */}
        <div className="lg:col-span-2 space-y-4">
          {mode === FORM_MODE && (
            <div className="nb-card p-5 md:p-6">
              <div className="label-eyebrow mb-2">Step 1</div>
              <h2 className="text-xl font-bold mb-4" style={{ fontFamily: "Outfit" }}>Tell DocuMind about your project</h2>
              <div className="space-y-4">
                {config.fields.map((f) => (
                  <FieldRenderer
                    key={f.name}
                    field={f}
                    value={values[f.name] || ""}
                    onChange={(v) => setValues({ ...values, [f.name]: v })}
                    fallbackIndustries={industries}
                  />
                ))}
              </div>

              <div className="flex flex-wrap gap-2 mt-6">
                <button
                  className="nb-btn flex-1 min-w-[180px]"
                  disabled={generating || !requiredOk}
                  onClick={generateFromForm}
                  data-testid={`generate-${type}-btn`}
                >
                  <Sparkles className="w-4 h-4" />
                  {generating ? "Generating…" : `Generate`}
                </button>
                <button
                  className="nb-btn nb-btn-ghost"
                  disabled={checking || !requiredOk}
                  onClick={runCompleteness}
                  data-testid="check-completeness-btn"
                >
                  <Gauge className="w-4 h-4" />
                  {checking ? "Checking…" : "Check completeness"}
                </button>
              </div>
              {!requiredOk && (
                <p className="text-xs text-[var(--muted)] mt-2">
                  Fill the required fields marked with <span className="text-red-500">*</span> to enable generation.
                </p>
              )}

              {check && (
                <div className="mt-5 border-2 border-[var(--ink)] rounded-lg p-3 bg-[var(--paper)]" data-testid="completeness-result">
                  <div className="flex items-center justify-between">
                    <div className="label-eyebrow">Completeness</div>
                    <span className="nb-chip" style={{ background: "var(--primary)" }}>{check.completeness_score}%</span>
                  </div>
                  {check.missing_fields?.length > 0 && (
                    <div className="mt-2 text-sm">
                      <div className="font-bold text-xs">Missing</div>
                      <ul className="list-disc ml-5">{check.missing_fields.map((m, i) => <li key={i}>{m}</li>)}</ul>
                    </div>
                  )}
                  {check.suggestions?.length > 0 && (
                    <div className="mt-2 text-sm">
                      <div className="font-bold text-xs">Suggestions</div>
                      <ul className="list-disc ml-5">{check.suggestions.map((m, i) => <li key={i}>{m}</li>)}</ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {mode === INTERVIEW_MODE && (
            <InterviewPanel docType={type} industry={industry} onComplete={generateFromInterview} />
          )}
        </div>

        {/* Right column: output */}
        <div className="lg:col-span-3 space-y-6">
          {!doc && !generating && <EmptyState config={config} />}
          {generating && <GeneratingState label={`Drafting your ${config.label.replace(" Generator", "")}…`} />}
          {doc && !generating && (
            <>
              <QualityScore score={doc.completeness_score} suggestions={doc.suggestions} />
              <DocumentViewer
                doc={doc}
                onUpdate={updateDoc}
                onRegenerate={() => {
                  if (mode === FORM_MODE) generateFromForm();
                }}
                regenerating={generating}
                onAfterAction={(updated) => setDoc(updated)}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function FieldRenderer({ field, value, onChange, fallbackIndustries }) {
  const id = `input-${slug(field.name)}`;
  const label = (
    <label className="block text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)] mb-1.5">
      {field.name}{field.required && <span className="text-red-500 ml-1">*</span>}
    </label>
  );
  if (field.type === "textarea") {
    return (
      <div data-testid={`field-${slug(field.name)}`}>
        {label}
        <textarea
          className="nb-input"
          rows={field.rows || 3}
          placeholder={field.placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          data-testid={id}
        />
      </div>
    );
  }
  if (field.type === "select") {
    const options = field.options || fallbackIndustries || [];
    return (
      <div data-testid={`field-${slug(field.name)}`}>
        {label}
        <select
          className="nb-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          data-testid={id}
        >
          <option value="">{field.placeholder || "Select…"}</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    );
  }
  return (
    <div data-testid={`field-${slug(field.name)}`}>
      {label}
      <input
        className="nb-input"
        type="text"
        placeholder={field.placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={id}
      />
    </div>
  );
}

function EmptyState({ config }) {
  return (
    <div className="nb-card p-8 md:p-10 text-center relative overflow-hidden" data-testid="generator-empty-state">
      <div aria-hidden className="absolute -top-8 -right-8 w-32 h-32 rounded-full border-2 border-[var(--ink)]" style={{ background: config.accent }} />
      <div aria-hidden className="absolute -bottom-6 -left-6 w-24 h-24 rounded-2xl border-2 border-[var(--ink)] bg-[var(--primary)] rotate-12" />
      <div className="relative z-10">
        <div className="label-eyebrow">Output preview</div>
        <h3 className="text-2xl font-black mt-1" style={{ fontFamily: "Outfit" }}>
          Your document will appear here
        </h3>
        <p className="text-sm text-[var(--muted)] mt-3 max-w-md mx-auto">
          Fill the form or run the AI interview, then hit <strong>Generate</strong>.
          DocuMind returns a fully structured {config.subtitle.toLowerCase()} with a
          quality score, version history, and one-click PDF/DOCX export.
        </p>
      </div>
    </div>
  );
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
