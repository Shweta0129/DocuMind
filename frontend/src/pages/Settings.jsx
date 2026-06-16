import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Settings as Cog, Save } from "lucide-react";
import { toast } from "sonner";

export default function Settings() {
  const [s, setS] = useState({
    company_name: "", company_logo_url: "", project_name: "",
    document_id: "", version_number: "", author: "",
    reviewer: "", approver: "", page_layout: "letter",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getSettings().then((d) => setS({ ...s, ...d })).catch(() => {}).finally(() => setLoading(false));
    // eslint-disable-next-line
  }, []);

  const save = async (e) => {
    e?.preventDefault();
    setSaving(true);
    try {
      const updated = await api.updateSettings(s);
      setS({ ...s, ...updated });
      toast.success("Settings saved");
    } catch { toast.error("Could not save"); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="p-10"><div className="h-10 w-1/3 shimmer rounded-md mb-4" /><div className="h-60 shimmer rounded-xl" /></div>;

  return (
    <div className="px-5 md:px-10 py-8 md:py-12 max-w-3xl mx-auto" data-testid="settings-page">
      <div className="mb-6">
        <div className="label-eyebrow flex items-center gap-1.5"><Cog className="w-3.5 h-3.5" /> Branding</div>
        <h1 className="text-3xl md:text-4xl font-black tracking-tight" style={{ fontFamily: "Outfit" }}>
          Branding & document defaults
        </h1>
        <p className="text-sm text-[var(--muted)] mt-2">
          These values appear in headers and footers of every exported DOCX.
        </p>
      </div>

      <form className="nb-card p-5 md:p-6 space-y-4" onSubmit={save} data-testid="settings-form">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input label="Company name" value={s.company_name} onChange={(v) => setS({ ...s, company_name: v })} testid="settings-company" />
          <Input label="Company logo URL" value={s.company_logo_url} onChange={(v) => setS({ ...s, company_logo_url: v })} testid="settings-logo" />
          <Input label="Default project name" value={s.project_name} onChange={(v) => setS({ ...s, project_name: v })} testid="settings-project" />
          <Input label="Default document ID" value={s.document_id} onChange={(v) => setS({ ...s, document_id: v })} testid="settings-doc-id" />
          <Input label="Default version" value={s.version_number} onChange={(v) => setS({ ...s, version_number: v })} testid="settings-version" />
          <Input label="Page layout" value={s.page_layout} onChange={(v) => setS({ ...s, page_layout: v })} testid="settings-layout" />
          <Input label="Author" value={s.author} onChange={(v) => setS({ ...s, author: v })} testid="settings-author" />
          <Input label="Reviewer" value={s.reviewer} onChange={(v) => setS({ ...s, reviewer: v })} testid="settings-reviewer" />
          <Input label="Approver" value={s.approver} onChange={(v) => setS({ ...s, approver: v })} testid="settings-approver" />
        </div>
        <button type="submit" className="nb-btn" disabled={saving} data-testid="settings-save-btn">
          <Save className="w-4 h-4" /> {saving ? "Saving…" : "Save settings"}
        </button>
      </form>
    </div>
  );
}

function Input({ label, value, onChange, testid }) {
  return (
    <div>
      <label className="label-eyebrow block mb-1">{label}</label>
      <input className="nb-input" value={value || ""} onChange={(e) => onChange(e.target.value)} data-testid={testid} />
    </div>
  );
}
