import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";

import { sanitizeHtml } from "@/features/notebook/html-sanitize";
import { OutputRenderer } from "../output-renderer";
import { SAMPLE_PDF, SAMPLE_PNG, SAMPLE_SVG } from "../samples";
import { pdfDataUrl } from "../model";
import { svgMarkupToDataUrl } from "@/features/notebook/images";

function Gallery() {
  const pdf = pdfDataUrl(SAMPLE_PDF);
  const svg = svgMarkupToDataUrl(SAMPLE_SVG);
  if (!pdf || !svg) return null;
  return (
    <div className="grid max-w-3xl gap-4">
      <OutputRenderer view={{ kind: "html", nodes: sanitizeHtml("<table><tr><td>S1</td></tr></table>") }} />
      <OutputRenderer view={{ kind: "image", mime: "image/png", src: `data:image/png;base64,${SAMPLE_PNG}`, alt: "散点图" }} />
      <OutputRenderer view={{ kind: "image", mime: "image/svg+xml", src: svg, alt: "色块" }} />
      <OutputRenderer view={{ kind: "pdf", src: pdf, title: "报告.pdf" }} />
      <OutputRenderer view={{ kind: "table", columns: ["sample", "reads"], rows: [["S1", "10"]], truncated: false }} />
      <OutputRenderer view={{ kind: "markdown", source: "# 备注\n\n- 完成\n" }} />
    </div>
  );
}

const meta = { title: "Output/Renderer" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const RichFiles: Story = {
  render: () => <Gallery />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getAllByRole("cell", { name: "S1" })).toHaveLength(2);
    await expect(canvas.getByRole("img", { name: "散点图" })).toBeInTheDocument();
    await expect(canvas.getByRole("img", { name: "色块" })).toBeInTheDocument();
    await expect(canvas.getByTitle("报告.pdf")).toBeInTheDocument();
    await expect(canvas.getByRole("columnheader", { name: "reads" })).toBeInTheDocument();
    await expect(canvas.getByRole("heading", { name: "备注" })).toBeInTheDocument();
  },
};
