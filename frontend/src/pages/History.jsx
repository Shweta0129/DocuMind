import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useCatalog, iconForName } from "../lib/catalog";
import { ArrowUpRight, Trash2, History as HistoryIcon, Filter, Search, Copy as CopyIcon, RotateCcw } from "lucide-react";
import { toast } from "sonner";

const SORTS = [
  { key: "created_desc", label: "Newest" },
  { key: "created_asc",  label: "Oldest" },
  { key: "title_asc",    label: "Title A-Z" },
  { key: "title_desc",   label: "Title Z-A" },
  { key: "score_desc",   label: "Quality ↓" },
  { key: "score_asc",    label: "Quality ↑" },
];

export default function History() {
  const { byKey, categories, industries } = useCatalog();
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState("all");
  const [type, setType] = useState("all");
  const [industry, setIndustry] = useState("all");
  const [sort, setSort] = useState("created_desc");
  const [q, setQ] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const params = { sort };
      if (type !== "all") params.type = type;
      if (category !== "all") params.category = category;
      if (industry !== "all") params.industry = industry;
      if (q.trim()) params.q = q.trim();
      const data = await api.listDocuments(params);
      setDocs(data);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [sort, type, category, industry]);

  const onSearch = (e) => { e.preventDefault(); load(); };

  const remove = async (id) => {
    if (!window.confirm("Delete this document permanently?")) return;
    await api.deleteDocument(id);
    setDocs((d) => d.filter((x) => x.id !== id));
    toast.success("Document deleted");
  };

  const duplicate = async (id) => {
    const out = await api.duplicateDocument(id);
    toast.success("Duplicated");
    setDocs((d) => [out, ...d]);
  };

  const regenerate = async (id) => {
    toast.info("Creating new version…");
    try {
      const out = await api.createNewVersion(id);
      toast.success(`New version v${out.version_number} created`);
      setDocs((d) => [out, ...d]);
    } catch { toast.error("Regenerate failed"); }
  };

  const typesForCategory = useMemo(() => {
    if (category === "all") return Object.values(byKey);
    return Object.values(byKey).filter((t) => byKey[t.key] && byKey[t.key].category === category);
    // Note: catalog `byKey` items don't include category right now; we get them via doc_types map
  }, [byKey, category]);

  return (
    <div className="px-5 md:px-10 py-8 md:py-12 max-w-7xl mx-auto" data-testid="history-page">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <div className="label-eyebrow flex items-center gap-1.5"><HistoryIcon className="w-3.5 h-3.5" /> Library</div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight" style={{ fontFamily: "Outfit" }}>
            Document library
          </h1>
          <p className="text-sm text-[var(--muted)] mt-1">Every document you&apos;ve generated, fully searchable and versioned.</p>
        </div>
      </div>

      {/* Search + filters */}
      <div className="nb-card p-4 md:p-5 mb-6" data-testid="history-filters">
        <form onSubmit={onSearch} className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[220px] relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)] pointer-events-none" />
            <input
              className="nb-input pl-9"
              placeholder="Search by title…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              data-testid="history-search-input"
            />
          </div>
          <button type="submit" className="nb-btn !py-2" data-testid="history-search-btn">Search</button>
        </form>
        <div className="flex flex-wrap gap-2 mt-3">
          <Select label="Category" value={category} onChange={(v) => { setCategory(v); setType("all"); }} options={[["all", "All"], ...Object.entries(categories).map(([k, v]) => [k, v])]} testid="filter-category" />
          <Select label="Type" value={type} onChange={setType} options={[["all", "All"], ...typesForCategory.map((t) => [t.key, t.label.replace(" Generator", "")])]} testid="filter-type" />
          <Select label="Industry" value={industry} onChange={setIndustry} options={[["all", "All"], ...industries.map((i) => [i, i])]} testid="filter-industry" />
          <Select label="Sort" value={sort} onChange={setSort} options={SORTS.map((s) => [s.key, s.label])} testid="filter-sort" />
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-28 rounded-xl shimmer" />)}
        </div>
      ) : docs.length === 0 ? (
        <div className="nb-card p-10 text-center">
          <h3 className="text-xl font-bold mb-2" style={{ fontFamily: "Outfit" }}>Nothing here yet</h3>
          <p className="text-[var(--muted)] mb-5">Generate your first document from the dashboard.</p>
          <Link to="/" className="nb-btn inline-flex" data-testid="empty-go-dashboard">Go to dashboard</Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="history-list">
          {docs.map((d) => {
            const g = byKey[d.type];
            const Icon = g ? iconForName(g.icon) : Filter;
            return (
              <div key={d.id} className="nb-card nb-card-hover p-5 flex items-start gap-4" data-testid={`history-item-${d.id}`}>
                <div
                  className="w-11 h-11 rounded-lg border-2 border-[var(--ink)] flex items-center justify-center flex-shrink-0"
                  style={{ background: g?.accent }}
                >
                  <Icon className="w-5 h-5" strokeWidth={2.5} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="label-eyebrow">
                    {(g?.label || d.type).replace(" Generator", "")} · v{d.version_number || "1.0"}
                    {d.industry ? ` · ${d.industry}` : ""}
                  </div>
                  <Link to={`/document/${d.id}`} className="block font-bold truncate hover:underline" style={{ fontFamily: "Outfit" }} data-testid={`history-open-${d.id}`}>
                    {d.title}
                  </Link>
                  <div className="text-xs text-[var(--muted)] mt-1">
                    Quality {d.completeness_score}% · {new Date(d.created_at).toLocaleString()}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => duplicate(d.id)} className="nb-btn nb-btn-ghost !px-2.5 !py-1.5" aria-label="Duplicate" data-testid={`history-duplicate-${d.id}`}>
                    <CopyIcon className="w-4 h-4" />
                  </button>
                  <button onClick={() => regenerate(d.id)} className="nb-btn nb-btn-ghost !px-2.5 !py-1.5" aria-label="Regenerate" data-testid={`history-regenerate-${d.id}`}>
                    <RotateCcw className="w-4 h-4" />
                  </button>
                  <Link to={`/document/${d.id}`} className="nb-btn nb-btn-ghost !px-2.5 !py-1.5" aria-label="Open" data-testid={`history-open-link-${d.id}`}>
                    <ArrowUpRight className="w-4 h-4" />
                  </Link>
                  <button onClick={() => remove(d.id)} className="nb-btn nb-btn-ghost !px-2.5 !py-1.5" data-testid={`history-delete-${d.id}`} aria-label="Delete">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Select({ label, value, onChange, options, testid }) {
  return (
    <label className="flex items-center gap-2">
      <span className="label-eyebrow">{label}</span>
      <select className="nb-input !py-1.5 !w-auto" value={value} onChange={(e) => onChange(e.target.value)} data-testid={testid}>
        {options.map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
      </select>
    </label>
  );
}
