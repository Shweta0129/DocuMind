import { useEffect, useState } from "react";

export default function QualityScore({ score = 0, suggestions = [] }) {
  const [animated, setAnimated] = useState(0);
  useEffect(() => {
    let raf;
    const start = performance.now();
    const dur = 900;
    const tick = (t) => {
      const p = Math.min(1, (t - start) / dur);
      setAnimated(Math.round(score * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [score]);

  const band =
    score >= 85 ? { label: "Excellent", color: "#A8E6CF" } :
    score >= 70 ? { label: "Good",      color: "#FFE45E" } :
    score >= 50 ? { label: "Fair",      color: "#FFD3B6" } :
                  { label: "Thin",      color: "#FFB6C1" };

  return (
    <div className="nb-card p-5 md:p-6" data-testid="quality-score">
      <div className="flex items-center justify-between">
        <div>
          <div className="label-eyebrow">Document Quality</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-4xl font-black" style={{ fontFamily: "Outfit" }} data-testid="quality-score-value">{animated}%</span>
            <span className="nb-chip" style={{ background: band.color }}>{band.label}</span>
          </div>
        </div>
        <div
          aria-hidden
          className="w-14 h-14 rounded-full border-2 border-[var(--ink)] flex items-center justify-center"
          style={{ background: band.color }}
        >
          <div className="w-7 h-7 rounded-full bg-[var(--surface)] border-2 border-[var(--ink)]" />
        </div>
      </div>

      <div className="mt-4 h-3 rounded-full border-2 border-[var(--ink)] bg-[var(--surface)] overflow-hidden">
        <div
          className="h-full transition-[width] duration-700"
          style={{ width: `${animated}%`, background: band.color }}
        />
      </div>

      {suggestions.length > 0 && (
        <div className="mt-5">
          <div className="label-eyebrow mb-2">Suggestions to improve</div>
          <ul className="space-y-2" data-testid="quality-suggestions">
            {suggestions.map((s, i) => (
              <li key={i} className="flex gap-2 text-sm leading-relaxed">
                <span className="font-black text-[var(--ink)]">›</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
