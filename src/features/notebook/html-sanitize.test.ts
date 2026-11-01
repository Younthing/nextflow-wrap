import { describe, expect, it } from "vitest";

import { htmlHasContent, sanitizeHtml } from "./html-sanitize";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function textOf(source: string): string {
  const walk = (nodes: ReturnType<typeof sanitizeHtml>): string =>
    nodes.map((node) => (node.kind === "text" ? node.text : walk(node.children))).join("");
  return walk(sanitizeHtml(source));
}

describe("sanitizeHtml", () => {
  it("keeps a dataframe table and drops scripts, styles, and handlers", () => {
    const nodes = sanitizeHtml(`
      <div>
        <style>.dataframe { color: red }</style>
        <table class="dataframe">
          <thead><tr style="text-align: right"><th></th><th>sample</th></tr></thead>
          <tbody><tr><th rowspan="2">0</th><td onclick="alert(1)">S1</td></tr></tbody>
        </table>
        <script>alert(1)</script>
      </div>
    `);
    expect(htmlHasContent(nodes)).toBe(true);
    const table = nodes.find((node) => node.kind === "element" && node.tag === "div");
    expect(table?.kind).toBe("element");
    const serialized = JSON.stringify(nodes);
    expect(serialized).toContain("S1");
    expect(serialized).toContain("sample");
    expect(serialized).toContain("\"rowSpan\":2");
    expect(serialized).not.toContain("onclick");
    expect(serialized).not.toContain("alert");
    expect(serialized).not.toContain("color: red");
    expect(serialized).not.toContain("<script");
  });

  it("unwraps javascript links and rejects unsafe images", () => {
    expect(textOf('<a href="javascript:alert(1)">名字</a>')).toBe("名字");
    expect(textOf('<img src="x" onerror="alert(1)" alt="图">')).toBe("图");
    const image = sanitizeHtml(`<img alt="点" src="data:image/png;base64,${PNG}">`);
    expect(image[0]).toMatchObject({
      kind: "element",
      tag: "img",
      attrs: { alt: "点", src: `data:image/png;base64,${PNG}` },
    });
  });
});
