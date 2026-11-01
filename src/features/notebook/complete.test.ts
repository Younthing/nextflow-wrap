import { describe, expect, it } from "vitest";

import { applyCompletion, completeAt, indentAt, tabEdit } from "./complete";

describe("completeAt", () => {
  it("completes Python builtins and names from the cell and earlier cells", () => {
    const found = completeAt("python", "pri", 3, "reads = 1\n");
    expect(found?.items).toContain("print");
    expect(found?.items[0]).toBe("print");
    expect(found?.start).toBe(0);

    const named = completeAt("python", "rea", 3, "reads = 1\n");
    expect(named?.items).toContain("reads");
  });

  it("completes R names, including dotted ones", () => {
    const found = completeAt("r", "data.f", 6);
    expect(found?.items).toContain("data.frame");
  });

  it("does not complete inside a string or comment", () => {
    expect(completeAt("python", 'print("pri', 10)).toBeNull();
    expect(completeAt("python", "# pri", 5)).toBeNull();
  });

  it("returns an empty prefix list for Ctrl+Space at a blank cursor", () => {
    const found = completeAt("python", "x = ", 4);
    expect(found?.prefix).toBe("");
    expect(found?.items.length).toBeGreaterThan(0);
  });
});

describe("applyCompletion", () => {
  it("replaces the prefix and parks the cursor after the word", () => {
    expect(applyCompletion("pri()", 3, 0, "print")).toEqual({ source: "print()", cursor: 5 });
  });
});

describe("tabEdit", () => {
  it("indents a blank caret, line start, and whitespace, and completes a typed prefix", () => {
    expect(tabEdit("python", "", 0, 0, false).type).toBe("indent");
    expect(tabEdit("python", "x = ", 4, 4, false).type).toBe("indent");
    expect(tabEdit("python", "\n", 1, 1, false).type).toBe("indent");
    expect(tabEdit("python", "  ", 2, 2, false).type).toBe("indent");
    expect(tabEdit("python", '"pri', 4, 4, false).type).toBe("indent");
    expect(tabEdit("python", "pri", 0, 3, false).type).toBe("indent");

    const prefixed = tabEdit("python", "pri", 3, 3, false);
    expect(prefixed.type).toBe("complete");
    if (prefixed.type === "complete") expect(prefixed.completion.items[0]).toBe("print");
  });

  it("outdents on Shift+Tab even when a prefix is present", () => {
    expect(tabEdit("python", "    pri", 7, 7, true).type).toBe("outdent");
    expect(tabEdit("python", "pri", 1, 3, true).type).toBe("outdent");
  });
});

describe("indentAt", () => {
  it("inserts four spaces at the caret and removes one indent from the line", () => {
    expect(indentAt("x", 1, 1, false)).toEqual({ source: "x    ", start: 5, end: 5 });
    expect(indentAt("    x", 4, 4, true)).toEqual({ source: "x", start: 0, end: 0 });
    expect(indentAt("    x", 5, 5, true)).toEqual({ source: "x", start: 1, end: 1 });
    expect(indentAt("  x", 3, 3, true)).toEqual({ source: "x", start: 1, end: 1 });
  });

  it("indents and outdents every line in the selection", () => {
    expect(indentAt("a\nb", 0, 3, false)).toEqual({ source: "    a\n    b", start: 4, end: 11 });
    expect(indentAt("    a\n    b", 4, 11, true)).toEqual({ source: "a\nb", start: 0, end: 3 });
  });
});
