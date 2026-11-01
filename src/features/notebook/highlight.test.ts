import { describe, expect, it } from "vitest";

import { codeWords, highlightSource, syntaxContext } from "./highlight";

function kinds(source: string, language: "python" | "r") {
  return highlightSource(source, language).filter((token) => token.kind).map((token) => [token.kind, token.text]);
}

describe("highlightSource", () => {
  it("colors Python keywords, calls, strings, numbers, and comments", () => {
    expect(kinds("print(1)  # 计数\n", "python")).toEqual([
      ["call", "print"],
      ["number", "1"],
      ["comment", "# 计数"],
    ]);
    expect(kinds("def read():\n    return 'ok'\n", "python")).toEqual([
      ["keyword", "def"],
      ["call", "read"],
      ["keyword", "return"],
      ["string", "'ok'"],
    ]);
  });

  it("keeps keywords inside strings and comments uncolored as keywords", () => {
    const tokens = highlightSource('label = "def import"  # return\n', "python");
    expect(tokens.some((token) => token.kind === "keyword")).toBe(false);
    expect(tokens).toContainEqual({ text: '"def import"', kind: "string" });
    expect(tokens).toContainEqual({ text: "# return", kind: "comment" });
  });

  it("keeps a triple-quoted Python string together", () => {
    const source = 'text = """a\nb"""\n';
    expect(highlightSource(source, "python")).toContainEqual({ text: '"""a\nb"""', kind: "string" });
  });

  it("colors R keywords, calls, strings, and comments", () => {
    expect(kinds('if (TRUE) cat("hi") # 注\n', "r")).toEqual([
      ["keyword", "if"],
      ["keyword", "TRUE"],
      ["call", "cat"],
      ["string", '"hi"'],
      ["comment", "# 注"],
    ]);
  });
});

describe("syntaxContext", () => {
  it("reports code, strings, and comments at the cursor", () => {
    const source = 'print("hi") # note';
    expect(syntaxContext(source, 0, "python")).toBe("code");
    expect(syntaxContext(source, source.indexOf("hi"), "python")).toBe("string");
    expect(syntaxContext(source, source.indexOf("note"), "python")).toBe("comment");
  });
});

describe("codeWords", () => {
  it("skips words inside strings", () => {
    expect(codeWords('reads = 1\nprint("reads")\n', "python")).toEqual(["reads", "print"]);
  });
});
