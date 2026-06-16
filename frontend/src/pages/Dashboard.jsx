import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import ModuleCard from "../components/ModuleCard";
import { api } from "../lib/api";
import { useCatalog } from "../lib/catalog";
import { Sparkles, Zap, FileCheck, Clock, ArrowUpRight, FileSearch, LayoutTemplate } from "lucide-react";

export default function Dashboard() {
  const { doc_types, loading: catalogLoading } = useCatalog();
  const [stats, setStats] = useState({ total: 0, by_type: {}, templates: 0, reviews: 0 });
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [s, docs] = await Promise.all([api.stats(), api.listDocuments()]);
        setStats(s);
        setRecent(docs.slice(0, 4));
      } catch (e) { /* silent */ }
      finally { setLoading(false); }
    })();
  }, []);

  return (
    <div className="px-5 md:px-10 py-8 md:py-12 max-w-7xl mx-auto" data-testid="dashboard">
      {/* Hero */}
      <section className="relative mb-12">
        <div className="flex items-center gap-2 mb-4 fade-up">
          <span className="nb-chip" style={{ background: "var(--primary)" }}>
            <Sparkles className="w-3.5 h-3.5" /> AI Documentation Copilot
          </span>
        </div>
        <h1
          className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight max-w-3xl fade-up delay-1"
          style={{ fontFamily: "Outfit" }}
          data-testid="dashboard-heading"
        >
          Enterprise documents,
          <br />
          <span className="bg-[var(--primary)] px-2 border-2 border-[var(--ink)] rounded-md inline-block mt-2">
            drafted in minutes.
          </span>
        </h1>
        <p className="text-base md:text-lg text-[var(--muted)] max-w-2xl mt-5 fade-up delay-2">
          DocuMind AI helps Business Analysts, PMs, QA Engineers, and Operations teams generate
          BRDs, SOPs, Agile user stories, and QA test cases — each with quality scoring, inline
          editing, and one-click PDF export.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8 fade-up delay-3">
          <StatTile icon={FileCheck} label="Documents" value={stats.total} testid="stat-total" />
          <StatTile icon={Zap}       label="Doc Types" value={Object.keys(stats.by_type || {}).length} testid="stat-types" />
          <StatTile icon={LayoutTemplate} label="Templates" value={stats.templates} testid="stat-templates" />
          <StatTile icon={FileSearch} label="Reviews" value={stats.reviews} testid="stat-reviews" />
        </div>
      </section>

      {/* Modules grouped by category */}
      <section className="mb-12">
        <div className="flex items-end justify-between mb-5">
          <div>
            <div className="label-eyebrow">Generators</div>
            <h2 className="text-2xl md:text-3xl font-black tracking-tight" style={{ fontFamily: "Outfit" }}>
              Choose what to draft
            </h2>
          </div>
        </div>

        {catalogLoading && <div className="h-40 rounded-xl shimmer" />}

        {!catalogLoading && Object.entries(doc_types).map(([catKey, cat]) => (
          <div key={catKey} className="mb-8" data-testid={`category-${catKey}`}>
            <div className="flex items-center gap-3 mb-3">
              <h3 className="text-lg font-bold" style={{ fontFamily: "Outfit" }}>{cat.label}</h3>
              <span className="nb-chip">{cat.types.length} docs</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
              {cat.types.map((g, i) => (
                <ModuleCard key={g.key} generator={g} index={(i % 4) + 1} />
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* Recent */}
      <section>
        <div className="flex items-end justify-between mb-5">
          <div>
            <div className="label-eyebrow">Recent activity</div>
            <h2 className="text-2xl md:text-3xl font-black tracking-tight" style={{ fontFamily: "Outfit" }}>
              Recently generated
            </h2>
          </div>
          <Link to="/history" className="nb-btn nb-btn-ghost" data-testid="view-history-link">
            View all <ArrowUpRight className="w-4 h-4" />
          </Link>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[0, 1].map((i) => <div key={i} className="h-28 rounded-xl shimmer" />)}
          </div>
        ) : recent.length === 0 ? (
          <div className="nb-card p-8 text-center">
            <p className="text-[var(--muted)]">No documents yet. Pick a module above to draft your first document.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {recent.map((d) => (
              <Link
                to={`/document/${d.id}`}
                key={d.id}
                className="nb-card nb-card-hover p-5 flex items-center justify-between gap-4"
                data-testid={`recent-doc-${d.id}`}
              >
                <div className="min-w-0">
                  <div className="label-eyebrow mb-1">{d.type.replace("-", " ")} · v{d.version_number || "1.0"}</div>
                  <div className="font-bold truncate" style={{ fontFamily: "Outfit" }}>{d.title}</div>
                  <div className="text-xs text-[var(--muted)] mt-1">
                    Quality {d.completeness_score}% · {new Date(d.created_at).toLocaleString()}
                  </div>
                </div>
                <ArrowUpRight className="w-5 h-5 flex-shrink-0" strokeWidth={2.5} />
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StatTile({ icon: Icon, label, value, testid }) {
  return (
    <div className="nb-card p-4 md:p-5" data-testid={testid}>
      <div className="flex items-center justify-between">
        <span className="label-eyebrow">{label}</span>
        <Icon className="w-4 h-4" strokeWidth={2.5} />
      </div>
      <div className="text-3xl font-black mt-2" style={{ fontFamily: "Outfit" }}>{value}</div>
    </div>
  );
}
