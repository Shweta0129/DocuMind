import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { iconForName } from "../lib/catalog";

export default function ModuleCard({ generator, index = 0 }) {
  const Icon = typeof generator.icon === "string" ? iconForName(generator.icon) : generator.icon;
  return (
    <Link
      to={`/generator/${generator.key}`}
      data-testid={`generator-card-${generator.key}`}
      className={`nb-card nb-card-hover p-6 flex flex-col gap-3 relative overflow-hidden group fade-up delay-${index}`}
    >
      <div
        aria-hidden
        className="absolute -top-6 -right-6 w-24 h-24 rounded-full border-2 border-[var(--ink)] opacity-90"
        style={{ background: generator.accent }}
      />
      <div
        aria-hidden
        className="absolute -top-2 -right-2 w-9 h-9 rounded-md border-2 border-[var(--ink)] bg-[var(--surface)]"
      />

      <div className="flex items-center gap-3 relative z-10">
        <div
          className="w-11 h-11 rounded-xl border-2 border-[var(--ink)] flex items-center justify-center shadow-[3px_3px_0_0_var(--ink)]"
          style={{ background: generator.accent }}
        >
          <Icon className="w-5 h-5" strokeWidth={2.5} />
        </div>
        <span className="nb-chip" data-testid={`module-tag-${generator.key}`}>{generator.tag}</span>
      </div>

      <div className="relative z-10">
        <h3 className="text-lg font-black tracking-tight" style={{ fontFamily: "Outfit" }}>
          {generator.label || generator.title}
        </h3>
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--muted)] mt-1">
          {generator.subtitle}
        </p>
      </div>

      <div className="flex items-center justify-between mt-1 relative z-10">
        <span className="text-sm font-bold">Open module</span>
        <span className="w-8 h-8 rounded-lg border-2 border-[var(--ink)] bg-[var(--primary)] flex items-center justify-center group-hover:translate-x-1 transition-transform">
          <ArrowUpRight className="w-4 h-4" strokeWidth={2.5} />
        </span>
      </div>
    </Link>
  );
}
