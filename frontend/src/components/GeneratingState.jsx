import { Sparkles, FileText } from "lucide-react";

export default function GeneratingState({ label = "Generating your document…" }) {
  return (
    <div className="nb-card p-8 md:p-12 text-center relative overflow-hidden" data-testid="generating-state">
      <div aria-hidden className="absolute -left-10 -top-10 w-40 h-40 rounded-full bg-[var(--mint)] border-2 border-[var(--ink)] blob opacity-80" />
      <div aria-hidden className="absolute -right-12 bottom-0 w-32 h-32 rounded-2xl bg-[var(--secondary)] border-2 border-[var(--ink)] blob opacity-80" style={{ animationDelay: "-3s" }} />
      <div aria-hidden className="absolute right-10 top-6 w-14 h-14 rounded-full bg-[var(--primary)] border-2 border-[var(--ink)] blob opacity-80" style={{ animationDelay: "-6s" }} />

      <div className="relative z-10 flex flex-col items-center gap-5">
        <div className="w-16 h-16 rounded-2xl bg-[var(--primary)] border-2 border-[var(--ink)] shadow-[4px_4px_0_0_var(--ink)] flex items-center justify-center">
          <Sparkles className="w-7 h-7 animate-pulse" strokeWidth={2.5} />
        </div>
        <div>
          <div className="label-eyebrow mb-2">Claude Sonnet 4.5 · Working</div>
          <h3 className="text-2xl font-black" style={{ fontFamily: "Outfit" }}>{label}</h3>
          <p className="text-sm text-[var(--muted)] mt-2 max-w-md mx-auto">
            DocuMind AI is structuring your inputs, drafting each section, and grading completeness. This usually takes 15–40 seconds.
          </p>
        </div>

        <div className="w-full max-w-md space-y-2 mt-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-3 rounded-md border-2 border-[var(--ink)] overflow-hidden shimmer" style={{ width: `${100 - i * 15}%` }} />
          ))}
        </div>

        <div className="flex items-center gap-2 text-xs font-bold text-[var(--muted)] mt-2">
          <FileText className="w-3.5 h-3.5" />
          <span>Generating structured Markdown sections…</span>
        </div>
      </div>
    </div>
  );
}
