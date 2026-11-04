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
  /** Short mark shown in the logo tile. */
  shortName: string;
  /** One-line description for page metadata. */
  description: string;
  /** Tagline under the product name on the welcome page. */
  tagline: string;
}

export const DEFAULT_PRODUCT_THEME: ProductTheme = {
  id: "nextflow-studio",
  displayName: "Nextflow Studio",
  shortName: "nf",
  description: "用笔记本、内置节点搭建并运行 Nextflow 流程",
  tagline: "笔记本到流程的工作台",
};

const PRODUCT_THEMES: readonly ProductTheme[] = [DEFAULT_PRODUCT_THEME];

/** Checks a theme against the contract; returns the problems found (empty when valid). */
export function validateProductTheme(theme: Partial<ProductTheme>): string[] {
  const problems: string[] = [];
  if (!theme.id || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(theme.id)) problems.push("id 必须是 kebab-case");
  for (const key of ["displayName", "shortName", "description", "tagline"] as const) {
    if (typeof theme[key] !== "string" || !theme[key]!.trim()) problems.push(`${key} 不能为空`);
  }
  return problems;
}

/** Resolves the active product theme by id; unknown or missing ids fall back to the default. */
export function resolveProductTheme(id?: string | null): ProductTheme {
  return PRODUCT_THEMES.find((theme) => theme.id === id) ?? DEFAULT_PRODUCT_THEME;
}

/** The active product theme. P0: always the default pack. */
export function getProductTheme(): ProductTheme {
  return resolveProductTheme();
}
