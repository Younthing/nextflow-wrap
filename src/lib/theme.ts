export type Theme = "light" | "dark";
export type ThemePreference = Theme | "system";

export const THEME_STORAGE_KEY = "nf-studio-theme";
export const DARK_MODE_QUERY = "(prefers-color-scheme: dark)";
let preferenceOverride: ThemePreference | undefined;

// Runs before hydration so the first paint already has the right theme.
export const THEME_INIT_SCRIPT = `(function(){var t;try{t=localStorage.getItem("${THEME_STORAGE_KEY}")}catch(e){}var root=document.documentElement;var dark=t==="dark"||(t!=="light"&&matchMedia("${DARK_MODE_QUERY}").matches);root.classList.toggle("dark",dark);root.style.colorScheme=dark?"dark":"light"})()`;

export function readThemePreference(): ThemePreference {
  if (preferenceOverride) return preferenceOverride;
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch { /* Storage may be unavailable. */ }
  return "system";
}

export function syncTheme(preference: ThemePreference) {
  const theme = preference === "system" ? (matchMedia(DARK_MODE_QUERY).matches ? "dark" : "light") : preference;
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

export function applyTheme(preference: ThemePreference) {
  syncTheme(preference);
  try {
    if (preference === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, preference);
    preferenceOverride = undefined;
  } catch {
    preferenceOverride = preference;
  }
}

export function watchTheme() {
  const media = matchMedia(DARK_MODE_QUERY);
  const sync = () => syncTheme(readThemePreference());
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
    preferenceOverride = undefined;
    sync();
  };
  sync();
  media.addEventListener("change", sync);
  window.addEventListener("storage", onStorage);
  return () => {
    media.removeEventListener("change", sync);
    window.removeEventListener("storage", onStorage);
  };
}
