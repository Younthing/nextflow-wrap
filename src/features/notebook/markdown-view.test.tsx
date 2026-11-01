import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MarkdownView } from "./components/markdown-view";
import { SafeHtml } from "./components/safe-html";
import { sanitizeHtml } from "./html-sanitize";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("MarkdownView", () => {
  it("renders headings, lists, a table, and an inline image", () => {
    const html = renderToStaticMarkup(
      <MarkdownView
        source={[
          "## 结果",
          "",
          "- 甲",
          "- 乙",
          "",
          "| 样本 | reads |",
          "| --- | ---: |",
          "| S1 | 10 |",
          "",
          `![点](data:image/png;base64,${PNG})`,
          "",
          "[站点](https://example.com)",
          "",
          "[坏](javascript:alert(1))",
          "",
          "<script>alert(1)</script>",
        ].join("\n")}
      />,
    );
    expect(html).toContain("<h2");
    expect(html).toContain("结果");
    expect(html).toContain("<li");
    expect(html).toContain("甲");
    expect(html).toContain("<table");
    expect(html).toContain("S1");
    expect(html).toContain(`data:image/png;base64,${PNG}`);
    expect(html).toContain('alt="点"');
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

describe("SafeHtml", () => {
  it("renders a table without executable markup", () => {
    const html = renderToStaticMarkup(
      <SafeHtml
        nodes={sanitizeHtml('<table><tr><td><a href="javascript:alert(1)">S1</a><img src=x onerror=alert(1)></td></tr></table>')}
      />,
    );
    expect(html).toContain("<table");
    expect(html).toContain("S1");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("<script");
  });
});
