"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { parseTheme, THEME_STORAGE_KEY, type Theme } from "./theme";

export type { Theme };

function resolvedTheme(theme: Theme): "light" | "dark" {
  if (theme === "system" && typeof window !== "undefined") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return theme === "dark" ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  const resolved = resolvedTheme(theme);
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.style.colorScheme = resolved;
}

const ThemeContext = createContext<{ theme: Theme; setTheme: (next: Theme) => void } | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    const next = parseTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
    setThemeState(next);
    applyTheme(next);
    if (next !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const setTheme = (next: Theme) => {
    setThemeState(next);
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
    applyTheme(next);
  };

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
