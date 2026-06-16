import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { LayoutTemplate, Upload, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";

export default function Templates() {
  const [templates, setTemplates] = useState([]);
  const [form, setForm] = useState({
    name: "", description: "", header: "", footer: "",
    document_id_prefix: "", version_number: "1.0",
    author: "", reviewer: "", approver: "",
  });
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const load = () => api.listTemplates().then(setTemplates).catch(() => {});
  useEffect(() => { load(); }, []);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!file) { toast.error("Pick a template file"); return; }
    if (!form.name.trim()) { toast.error("Template name is required"); return; }
    setUploading(true);
    try {
      const t = await api.uploadTemplate(file, form);
      toast.success("Template saved");
      setTemplates((cur) => [t, ...cur]);
      setForm({ name: "", description: "", header: "", footer: "", document_id_prefix: "", version_number: "1.0", author: "", reviewer: "", approver: "" });
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Upload failed");
    } finally { setUploading(false); }
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this template?")) return;
    await api.deleteTemplate(id);
    setTemplates((t) => t.filter((x) => x.id !== id));
    toast.success("Template deleted");
  };

  return (
    <div className="px-5 md:px-10 py-8 md:py-12 max-w-7xl mx-auto" data-testid="templates-page">
      <div className="mb-6">
        <div className="label-eyebrow flex items-center gap-1.5"><LayoutTemplate className="w-3.5 h-3.5" /> Templates</div>
        <h1 className="text-3xl md:text-4xl font-black tracking-tight" style={{ fontFamily: "Outfit" }}>
          Company templates
        </h1>
        <p className="text-sm text-[var(--muted)] mt-2 max-w-2xl">
          Upload your company&apos;s BRD / SOP / policy templates. DocuMind will apply the header,
          footer, document ID, and signatory fields you configure here whenever you export to DOCX.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Upload form */}
        <form className="nb-card p-5 lg:col-span-2 space-y-3" onSubmit={onSubmit} data-testid="template-upload-form">
          <h3 className="font-bold text-lg" style={{ fontFamily: "Outfit" }}>Upload a template</h3>

          <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.md" onChange={(e) => setFile(e.target.files?.[0])} hidden data-testid="template-file-input" />
          <button type="button" className="nb-btn nb-btn-ghost w-full" onClick={() => fileRef.current?.click()} data-testid="template-pick-file-btn">
            <Upload className="w-4 h-4" /> {file ? file.name : "Choose file (PDF / DOCX)"}
          </button>

          <Input label="Template name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required testid="template-name" />
          <TextArea label="Description" value={form.description} onChange={(v) => setForm({ ...form, description: v })} testid="template-description" />
          <Input label="Header text" value={form.header} onChange={(v) => setForm({ ...form, header: v })} testid="template-header" />
          <Input label="Footer text" value={form.footer} onChange={(v) => setForm({ ...form, footer: v })} testid="template-footer" />
          <div className="grid grid-cols-2 gap-2">
            <Input label="Doc ID prefix" value={form.document_id_prefix} onChange={(v) => setForm({ ...form, document_id_prefix: v })} testid="template-doc-id" />
            <Input label="Version" value={form.version_number} onChange={(v) => setForm({ ...form, version_number: v })} testid="template-version" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Input label="Author" value={form.author} onChange={(v) => setForm({ ...form, author: v })} testid="template-author" />
            <Input label="Reviewer" value={form.reviewer} onChange={(v) => setForm({ ...form, reviewer: v })} testid="template-reviewer" />
            <Input label="Approver" value={form.approver} onChange={(v) => setForm({ ...form, approver: v })} testid="template-approver" />
          </div>

          <button type="submit" className="nb-btn w-full" disabled={uploading} data-testid="template-save-btn">
            <Plus className="w-4 h-4" /> {uploading ? "Uploading…" : "Save template"}
          </button>
        </form>

        {/* List */}
        <div className="lg:col-span-3">
          <div className="label-eyebrow mb-2">Saved templates</div>
          {templates.length === 0 ? (
            <div className="nb-card p-6 text-sm text-[var(--muted)]" data-testid="templates-empty">
              No templates yet. Upload one to get started.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3" data-testid="templates-list">
              {templates.map((t) => (
                <div key={t.id} className="nb-card p-4 flex items-start gap-4" data-testid={`template-item-${t.id}`}>
                  <div className="w-11 h-11 rounded-lg border-2 border-[var(--ink)] flex items-center justify-center bg-[var(--primary)]">
                    <LayoutTemplate className="w-5 h-5" strokeWidth={2.5} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold truncate" style={{ fontFamily: "Outfit" }}>{t.name}</div>
                    <div className="text-xs text-[var(--muted)]">{t.filename} · {Math.round((t.size_bytes || 0) / 1024)} KB</div>
                    {t.description && <p className="text-sm mt-1">{t.description}</p>}
                    <div className="text-xs text-[var(--muted)] mt-1.5 flex flex-wrap gap-x-3">
                      {t.document_id_prefix && <span>ID: {t.document_id_prefix}-…</span>}
                      {t.version_number && <span>v{t.version_number}</span>}
                      {t.author && <span>Author: {t.author}</span>}
                      {t.reviewer && <span>Reviewer: {t.reviewer}</span>}
                      {t.approver && <span>Approver: {t.approver}</span>}
                    </div>
                  </div>
                  <button onClick={() => remove(t.id)} className="nb-btn nb-btn-ghost !px-2.5 !py-1.5" aria-label="Delete" data-testid={`template-delete-${t.id}`}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Input({ label, value, onChange, required, testid }) {
  return (
    <div>
      <label className="label-eyebrow block mb-1">{label}{required && <span className="text-red-500 ml-1">*</span>}</label>
      <input className="nb-input" value={value} onChange={(e) => onChange(e.target.value)} required={required} data-testid={testid} />
    </div>
  );
}
function TextArea({ label, value, onChange, testid }) {
  return (
    <div>
      <label className="label-eyebrow block mb-1">{label}</label>
      <textarea className="nb-input min-h-[60px]" value={value} onChange={(e) => onChange(e.target.value)} data-testid={testid} />
    </div>
  );
}
