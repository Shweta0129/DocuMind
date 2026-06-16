import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Sparkles, LayoutDashboard, History, Sun, Moon, Github,
  FileSearch, LayoutTemplate, Settings as Cog, ChevronDown, ChevronRight,
} from "lucide-react";
import { useTheme } from "../lib/theme";
import { useCatalog, iconForName } from "../lib/catalog";

export default function Layout({ children }) {
  const { theme, toggle } = useTheme();
  const location = useLocation();
  const { doc_types, loading } = useCatalog();
  const [openCats, setOpenCats] = useState({}); // category key → bool

  return (
    <div className="min-h-screen flex flex-col md:flex-row" data-testid="app-shell">
      {/* Sidebar */}
      <aside
        className="md:w-72 md:min-h-screen md:border-r-2 border-b-2 md:border-b-0 border-[var(--ink)] bg-[var(--surface)] flex md:flex-col md:sticky md:top-0 md:h-screen z-30"
        data-testid="sidebar"
      >
        <div className="flex items-center gap-3 px-5 py-5 md:py-7 border-b-2 border-[var(--ink)] w-full md:w-auto">
          <div
            className="w-10 h-10 rounded-lg bg-[var(--primary)] border-2 border-[var(--ink)] flex items-center justify-center shadow-[3px_3px_0_0_var(--ink)]"
            aria-hidden
          >
            <Sparkles className="w-5 h-5" strokeWidth={2.5} />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="font-black text-lg tracking-tight" style={{ fontFamily: "Outfit" }}>
              DocuMind <span className="text-[var(--muted)]">AI</span>
            </span>
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
              Documentation Copilot
            </span>
          </div>
        </div>

        <nav className="hidden md:flex flex-col gap-1 p-4 flex-1 overflow-y-auto" data-testid="sidebar-nav">
          <NavItem to="/" icon={LayoutDashboard} label="Dashboard" testid="nav-dashboard" />
          <NavItem to="/history" icon={History} label="Document Library" testid="nav-history" />
          <NavItem to="/reviewer" icon={FileSearch} label="Document Reviewer" testid="nav-reviewer" />
          <NavItem to="/templates" icon={LayoutTemplate} label="Templates" testid="nav-templates" />
          <NavItem to="/settings" icon={Cog} label="Branding & Settings" testid="nav-settings" />

          <div className="label-eyebrow px-3 mt-4 mb-1">Generators</div>
          {loading && (
            <div className="px-3 py-2 text-xs text-[var(--muted)]">Loading…</div>
          )}
          {Object.entries(doc_types).map(([catKey, cat]) => {
            const isOpen = openCats[catKey] ?? (catKey === "ba");
            return (
              <div key={catKey} className="mb-1">
                <button
                  type="button"
                  onClick={() => setOpenCats((o) => ({ ...o, [catKey]: !isOpen }))}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg border-2 border-transparent hover:bg-[var(--paper)] hover:border-[var(--ink)] text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]"
                  data-testid={`cat-toggle-${catKey}`}
                >
                  <span>{cat.label}</span>
                  {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                </button>
                {isOpen && (
                  <div className="ml-2 mt-1 flex flex-col gap-0.5">
                    {cat.types.map((t) => (
                      <NavItem
                        key={t.key}
                        to={`/generator/${t.key}`}
                        icon={iconForName(t.icon)}
                        label={t.label.replace(" Generator", "")}
                        accent={t.accent}
                        testid={`nav-${t.key}`}
                        small
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="hidden md:flex flex-col gap-2 p-4 border-t-2 border-[var(--ink)]">
          <button
            type="button"
            onClick={toggle}
            className="nb-btn nb-btn-ghost w-full"
            data-testid="theme-toggle"
            aria-label="Toggle theme"
          >
            {theme === "light" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            <span>{theme === "light" ? "Dark" : "Light"} mode</span>
          </button>
          <div className="flex items-center gap-2 text-xs text-[var(--muted)] px-1">
            <Github className="w-3.5 h-3.5" />
            <span>Powered by Claude Sonnet 4.5</span>
          </div>
        </div>
      </aside>

      <main className="flex-1 min-w-0" data-testid="main-content">
        <header className="md:hidden flex items-center justify-between px-4 py-3 border-b-2 border-[var(--ink)] bg-[var(--surface)] sticky top-0 z-20">
          <span className="font-bold">DocuMind AI</span>
          <button onClick={toggle} className="nb-btn nb-btn-ghost !px-3 !py-1.5" aria-label="Toggle theme" data-testid="theme-toggle-mobile">
            {theme === "light" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
          </button>
        </header>
        <div key={location.pathname} className="fade-up">
          {children}
        </div>
      </main>
    </div>
  );
}

function NavItem({ to, icon: Icon, label, accent, testid, small }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      data-testid={testid}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 ${small ? "py-2 text-sm" : "py-2.5 text-sm"} rounded-lg border-2 font-semibold transition-all ${
          isActive
            ? "bg-[var(--primary)] border-[var(--ink)] shadow-[3px_3px_0_0_var(--ink)]"
            : "border-transparent hover:bg-[var(--paper)] hover:border-[var(--ink)]"
        }`
      }
    >
      <span
        className={`${small ? "w-5 h-5" : "w-6 h-6"} rounded-md border-2 border-[var(--ink)] flex items-center justify-center`}
        style={{ background: accent || "transparent" }}
      >
        <Icon className={`${small ? "w-3 h-3" : "w-3.5 h-3.5"}`} strokeWidth={2.5} />
      </span>
      <span className="truncate">{label}</span>
    </NavLink>
  );
}
