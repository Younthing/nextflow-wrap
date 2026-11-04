import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_PRODUCT_THEME, FLUORA_PRODUCT_THEME, PRODUCT_THEMES, getProductTheme, resolveProductTheme, validateProductTheme,
} from "./index";

describe("product theme", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("every registered pack satisfies the contract with a unique id", () => {
    for (const theme of PRODUCT_THEMES) expect(validateProductTheme(theme)).toEqual([]);
    expect(new Set(PRODUCT_THEMES.map((t) => t.id)).size).toBe(PRODUCT_THEMES.length);
  });

  it("resolves the Fluora pack by id", () => {
    expect(resolveProductTheme("fluora")).toBe(FLUORA_PRODUCT_THEME);
  });

  it("selects the active pack from NEXT_PUBLIC_PRODUCT_THEME", () => {
    vi.stubEnv("NEXT_PUBLIC_PRODUCT_THEME", "fluora");
    expect(getProductTheme()).toBe(FLUORA_PRODUCT_THEME);
    vi.stubEnv("NEXT_PUBLIC_PRODUCT_THEME", "nope");
    expect(getProductTheme()).toBe(DEFAULT_PRODUCT_THEME);
  });

  it("default pack satisfies the contract", () => {
    expect(validateProductTheme(DEFAULT_PRODUCT_THEME)).toEqual([]);
  });

  it("reports missing fields and bad ids", () => {
    expect(validateProductTheme({ id: "Bad Id", displayName: " " })).toEqual([
      "id 必须是 kebab-case", "displayName 不能为空", "shortName 不能为空", "description 不能为空", "tagline 不能为空",
    ]);
  });

  it("resolves the default for missing or unknown ids", () => {
    expect(getProductTheme()).toBe(DEFAULT_PRODUCT_THEME);
    expect(resolveProductTheme("nextflow-studio")).toBe(DEFAULT_PRODUCT_THEME);
    expect(resolveProductTheme("nope")).toBe(DEFAULT_PRODUCT_THEME);
    expect(resolveProductTheme(null)).toBe(DEFAULT_PRODUCT_THEME);
  });
});
