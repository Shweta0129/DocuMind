import { createContext, useContext, useEffect, useState } from "react";
import { api } from "./api";
import * as Icons from "lucide-react";

// Map every icon name used in doc_types.py → lucide-react component.
export const ICON_MAP = {
  FileText: Icons.FileText,
  FileSpreadsheet: Icons.FileSpreadsheet,
  Code2: Icons.Code2,
  BookUser: Icons.BookUser,
  Workflow: Icons.Workflow,
  Flag: Icons.Flag,
  AlertTriangle: Icons.AlertTriangle,
  ListChecks: Icons.ListChecks,
  Users: Icons.Users,
  Crosshair: Icons.Crosshair,
  FlaskConical: Icons.FlaskConical,
  ClipboardCheck: Icons.ClipboardCheck,
  Target: Icons.Target,
  Network: Icons.Network,
  Bug: Icons.Bug,
  ClipboardList: Icons.ClipboardList,
  Wrench: Icons.Wrench,
  GitBranch: Icons.GitBranch,
  ShieldCheck: Icons.ShieldCheck,
  BadgeCheck: Icons.BadgeCheck,
  Search: Icons.Search,
  Stethoscope: Icons.Stethoscope,
  Microscope: Icons.Microscope,
  Cog: Icons.Cog,
  HardHat: Icons.HardHat,
  BookOpen: Icons.BookOpen,
  Book: Icons.Book,
  UserPlus: Icons.UserPlus,
  GraduationCap: Icons.GraduationCap,
};

export function iconForName(name) {
  return ICON_MAP[name] || Icons.FileText;
}

const CatalogCtx = createContext({
  loading: true,
  doc_types: {},           // grouped by category
  byKey: {},               // key → type meta
  categories: {},
  industries: [],
  pipeline: {},
});

export function CatalogProvider({ children }) {
  const [state, setState] = useState({
    loading: true, doc_types: {}, byKey: {}, categories: {}, industries: [], pipeline: {},
  });

  useEffect(() => {
    (async () => {
      try {
        const data = await api.catalog();
        const byKey = {};
        Object.values(data.doc_types).forEach((cat) => {
          cat.types.forEach((t) => { byKey[t.key] = t; });
        });
        setState({ loading: false, ...data, byKey });
      } catch {
        setState((s) => ({ ...s, loading: false }));
      }
    })();
  }, []);

  return <CatalogCtx.Provider value={state}>{children}</CatalogCtx.Provider>;
}

export const useCatalog = () => useContext(CatalogCtx);
