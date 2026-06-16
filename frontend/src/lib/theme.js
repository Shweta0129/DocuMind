import { useEffect, useState } from "react";

const STORAGE_KEY = "docu-mind-theme";

export function ThemeProvider({ children }) {
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) || "light";
    document.documentElement.classList.toggle("dark", saved === "dark");
  }, []);
  return children;
}

export function useTheme() {
  const [theme, setTheme] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) || "light" : "light"
  );

  const toggle = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    localStorage.setItem(STORAGE_KEY, next);
    document.documentElement.classList.toggle("dark", next === "dark");
  };

  return { theme, toggle };
}
