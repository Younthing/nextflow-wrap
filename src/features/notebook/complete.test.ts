import { describe, expect, it } from "vitest";

import { applyCompletion, completeAt, indentAt } from "./complete";

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

describe("indentAt", () => {
  it("inserts four spaces and removes one indent level", () => {
    expect(indentAt("x", 1, false)).toEqual({ source: "x    ", cursor: 5 });
    expect(indentAt("    x", 4, true)).toEqual({ source: "x", cursor: 0 });
  });
});
