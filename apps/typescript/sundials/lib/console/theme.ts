export type Theme = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "sundials-theme";

export function parseTheme(value: string | null | undefined): Theme {
  if (value === "dark" || value === "light" || value === "system") return value;
  return "light";
}

export const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});var dark=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(dark)document.documentElement.classList.add("dark");}catch(e){}})();`;
