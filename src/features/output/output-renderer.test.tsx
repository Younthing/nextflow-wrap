import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { sanitizeHtml } from "@/features/notebook/html-sanitize";
import { OutputRenderer } from "./output-renderer";
import { SAMPLE_PDF, SAMPLE_PNG } from "./samples";

describe("OutputRenderer", () => {
  it("renders the shared html, image, pdf, table, and markdown views", () => {
    const html = renderToStaticMarkup(
      <OutputRenderer view={{ kind: "html", nodes: sanitizeHtml("<table><tr><td>S1</td></tr></table>") }} />,
    );
    expect(html).toContain("data-output=\"html\"");
    expect(html).toContain("S1");

    const image = renderToStaticMarkup(
      <OutputRenderer view={{ kind: "image", mime: "image/png", src: `data:image/png;base64,${SAMPLE_PNG}`, alt: "散点图" }} />,
    );
    expect(image).toContain("data-output=\"image\"");
    expect(image).toContain("alt=\"散点图\"");

    const pdf = renderToStaticMarkup(
      <OutputRenderer view={{ kind: "pdf", src: `data:application/pdf;base64,${SAMPLE_PDF}`, title: "报告.pdf" }} />,
    );
    expect(pdf).toContain("data-output=\"pdf\"");
    expect(pdf).toContain("title=\"报告.pdf\"");

    const table = renderToStaticMarkup(
      <OutputRenderer view={{ kind: "table", columns: ["sample", "reads"], rows: [["S1", "10"]], truncated: false }} />,
    );
    expect(table).toContain("data-output=\"table\"");
    expect(table).toContain("S1");
    expect(table).toContain("reads");

    const markdown = renderToStaticMarkup(<OutputRenderer view={{ kind: "markdown", source: "# 备注\n" }} />);
    expect(markdown).toContain("data-output=\"markdown\"");
    expect(markdown).toContain("备注");

    const document = renderToStaticMarkup(
      <OutputRenderer view={{ kind: "html-document", html: "<p>MultiQC</p>", title: "multiqc_report.html" }} />,
    );
    expect(document).toContain("sandbox=\"\"");
    expect(document).toContain("MultiQC");

    expect(renderToStaticMarkup(<OutputRenderer view={{ kind: "empty" }} />)).toContain("无法安全显示");
  });
});
