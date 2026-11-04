import themes from "./themes.json";

/**
 * Product theme: the product's appearance identity (name, tagline, brand copy).
 * Appearance only — modules, workflows, example projects, appId and data paths
 * stay in Core. Not to be confused with the light/dark CSS theme in `@/lib/theme`.
 */
export interface ProductTheme {
  /** Stable id, kebab-case. */
  id: string;
  /** Full product name shown in titles, tray and welcome screens. */
  displayName: string;
  /** Text fallback for the logo tile when a theme has no SVG mark (see `./mark`). */
  shortName: string;
  /** One-line description for page metadata. */
  description: string;
  /** Tagline under the product name on the welcome page. */
  tagline: string;
  /** Desktop installer filename prefix, independent of the stable application id. */
  artifactPrefix: string;
  copyright: string;
  /** PNG assets under public/, also used by desktop packaging. */
  icon: string;
  trayIcon: string;
}

export const PRODUCT_THEMES: readonly ProductTheme[] = themes;
export const DEFAULT_PRODUCT_THEME = PRODUCT_THEMES[0];
export const FLUORA_PRODUCT_THEME = PRODUCT_THEMES.find((theme) => theme.id === "fluora")!;

/** Checks a theme against the contract; returns the problems found (empty when valid). */
export function validateProductTheme(theme: Partial<ProductTheme>): string[] {
  const problems: string[] = [];
  if (!theme.id || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(theme.id)) problems.push("id 必须是 kebab-case");
  for (const key of ["displayName", "shortName", "description", "tagline", "artifactPrefix", "copyright", "icon", "trayIcon"] as const) {
    if (typeof theme[key] !== "string" || !theme[key]!.trim()) problems.push(`${key} 不能为空`);
  }
  return problems;
}

/** Resolves the active product theme by id; unknown or missing ids fall back to the default. */
export function resolveProductTheme(id?: string | null): ProductTheme {
  return PRODUCT_THEMES.find((theme) => theme.id === id) ?? DEFAULT_PRODUCT_THEME;
}

/**
 * The active product theme, selected by `NEXT_PUBLIC_PRODUCT_THEME=<id>` (e.g. `fluora`).
 * Unset or unknown ids fall back to the default. NEXT_PUBLIC_ so Next inlines it into client
 * components at build time; the desktop bundler inlines the same id from the project's .env* files.
 */
export function getProductTheme(): ProductTheme {
  return resolveProductTheme(process.env.NEXT_PUBLIC_PRODUCT_THEME);
}
