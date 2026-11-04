import { describe, expect, it } from "vitest";

import { DEFAULT_PRODUCT_THEME, getProductTheme, resolveProductTheme, validateProductTheme } from "./index";

describe("product theme", () => {
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
