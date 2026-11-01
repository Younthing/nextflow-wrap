import { describe, expect, it } from "vitest";

import { convertNotebook, scriptFileName } from "./convert";
import { executeCells, executeTryRun } from "./execute";
import { planMime } from "./mime";
import { demoNotebooks } from "./seed";
import { simulateTryRun } from "./simulate";
import type { CellOutput, NotebookCell, NotebookDoc } from "./types";

const qc = () => demoNotebooks().find((doc) => doc.id === "qc_summary")!;

describe("executeTryRun", () => {
  it("runs the generated qc_summary CLI and checks output files", async () => {
    const notebook = qc();
    const scriptName = scriptFileName(convertNotebook(notebook).entry);
    const record = await executeTryRun(
      notebook,
      { fastq_zip: "S1_fastq.zip,S2_fastq.zip", min_q: "30", title: "QC 汇总" },
      "fastqc-pair",
    );
    expect(record.exitCode).toBe(0);
    expect(record.passed).toBe(true);
    expect(record.outputs.map((output) => [output.name, output.ok])).toEqual([
      ["report", true],
      ["stats", true],
    ]);
    expect(record.log).not.toContain("explore");
    expect(record.log.startsWith(`$ python3 ${scriptName} `)).toBe(true);
    expect(record.log).not.toContain("main.py");
    const demo = simulateTryRun(notebook, {
      fastq_zip: "S1_fastq.zip,S2_fastq.zip",
      min_q: "30",
      title: "QC 汇总",
    });
    expect(demo.log.split("\n")[0]).toBe(record.log.split("\n")[0]);
  });
});

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const JPEG = "/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYwLjMxLjEwMgD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABMAAEBAAAAAAAAAAAAAAAAAAAABgEBAQAAAAAAAAAAAAAAAAAABgcQAQAAAAAAAAAAAAAAAAAAAAARAQAAAAAAAAAAAAAAAAAAAAD/wAARCAAIAAgDASIAAhEAAxEA/9oADAMBAAIRAxEAPwCLAFF/f//Z";

function pythonDoc(cells: NotebookCell[]): NotebookDoc {
  return {
    id: "rich",
    name: "rich",
    description: "",
    kernel: "python3.11",
    language: "python",
    cells,
    rev: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function bundleOf(outputs: CellOutput[] | undefined, id: string) {
  const found = outputs?.find((item) => item.outputType === "execute_result" || item.outputType === "display_data");
  if (!found || found.outputType === "stream" || found.outputType === "error") {
    throw new Error(`${id} did not return a rich bundle`);
  }
  return found;
}

describe("executeCells", () => {
  it("runs earlier cells before the selected cell and stops there", async () => {
    const notebook = qc();
    const stopped = await executeCells(notebook, "c2");
    expect(stopped.map((cell) => cell.id)).toEqual(["c1", "c2"]);
    expect(stopped.every((cell) => !cell.error)).toBe(true);

    const isolated = await executeCells({
      ...notebook,
      cells: notebook.cells.filter((cell) => cell.id === "c4"),
    });
    expect(isolated).toHaveLength(1);
    expect(isolated[0]?.error).toMatch(/NameError/);
  });

  it("collects html tables, images, stdout, and errors from one kernel", async () => {
    const cells: NotebookCell[] = [
      { id: "print", role: "code", source: "print('once')\n" },
      {
        id: "html",
        role: "code",
        source: [
          "class Frame:",
          "    def _repr_html_(self):",
          "        return '<div><style>.x{}</style><table><thead><tr><th>sample</th></tr></thead><tbody><tr><td>S1</td></tr></tbody></table><script>alert(1)</script></div>'",
          "    def __repr__(self):",
          "        return 'plain-frame'",
          "Frame()",
          "",
        ].join("\n"),
      },
      {
        id: "png",
        role: "code",
        source: [
          "import base64",
          "class Pic:",
          "    def _repr_png_(self):",
          `        return base64.b64decode('${PNG}')`,
          "    def __repr__(self):",
          "        return '散点图'",
          "Pic()",
          "",
        ].join("\n"),
      },
      {
        id: "jpeg",
        role: "code",
        source: [
          "import base64",
          "class Photo:",
          "    def _repr_jpeg_(self):",
          `        return base64.b64decode('${JPEG}')`,
          "    def __repr__(self):",
          "        return '照片'",
          "Photo()",
          "",
        ].join("\n"),
      },
      {
        id: "svg",
        role: "code",
        source: [
          "class Svg:",
          "    def _repr_svg_(self):",
          "        return '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"8\" height=\"8\"><rect width=\"8\" height=\"8\"/></svg>'",
          "    def __repr__(self):",
          "        return '色块'",
          "Svg()",
          "",
        ].join("\n"),
      },
      {
        id: "stack",
        role: "code",
        source: [
          "print('before')",
          "class Box:",
          "    def _repr_html_(self):",
          "        return '<p>box</p>'",
          "    def __repr__(self):",
          "        return 'box'",
          "display(Box())",
          "print('after')",
          "",
        ].join("\n"),
      },
      {
        id: "both",
        role: "code",
        source: [
          "import base64",
          "class Both:",
          "    def _repr_html_(self):",
          "        return '<table><tr><td>html-wins</td></tr></table>'",
          "    def _repr_png_(self):",
          `        return base64.b64decode('${PNG}')`,
          "    def __repr__(self):",
          "        return 'both'",
          "Both()",
          "",
        ].join("\n"),
      },
      {
        id: "quiet",
        role: "code",
        source: [
          "class Hidden:",
          "    def _repr_html_(self):",
          "        return '<p>hidden</p>'",
          "Hidden();",
          "",
        ].join("\n"),
      },
      {
        id: "figure",
        role: "code",
        source: [
          "import base64, sys, types",
          `PNG = '${PNG}'`,
          "class Figure:",
          "    def savefig(self, buf, format='png', bbox_inches=None):",
          "        buf.write(base64.b64decode(PNG))",
          "    def __repr__(self):",
          "        return 'Figure 1'",
          "fig = Figure()",
          "open_figs = {1: fig}",
          "plt = types.ModuleType('matplotlib.pyplot')",
          "plt.get_fignums = lambda: list(open_figs)",
          "plt.figure = lambda n: open_figs[n]",
          "def close(target):",
          "    if target in open_figs:",
          "        open_figs.pop(target, None)",
          "        return",
          "    for num, item in list(open_figs.items()):",
          "        if item is target:",
          "            open_figs.pop(num, None)",
          "plt.close = close",
          "sys.modules['matplotlib'] = types.ModuleType('matplotlib')",
          "sys.modules['matplotlib.pyplot'] = plt",
          "",
        ].join("\n"),
      },
      { id: "stderr", role: "code", source: "import sys\nsys.stderr.write('warn\\n')\n" },
      { id: "boom", role: "code", source: "print('kept')\nraise RuntimeError('boom')\n" },
    ];
    const results = await executeCells(pythonDoc(cells));
    const byId = Object.fromEntries(results.map((cell) => [cell.id, cell]));

    expect(byId.print?.stdout).toBe("once\n");
    expect(byId.print?.outputs).toEqual([{ outputType: "stream", name: "stdout", text: "once\n" }]);

    const html = bundleOf(byId.html?.outputs, "html");
    expect(html.data["text/html"]).toContain("<table");
    expect(html.data["text/plain"]).toBe("plain-frame");
    const htmlPlan = planMime(html.data);
    expect(htmlPlan.kind).toBe("html");
    if (htmlPlan.kind === "html") {
      const markup = JSON.stringify(htmlPlan.nodes);
      expect(markup).toContain("S1");
      expect(markup).not.toContain("alert");
      expect(markup).not.toContain("script");
      expect(markup).not.toContain(".x{}");
    }

    expect(planMime(bundleOf(byId.png?.outputs, "png").data)).toMatchObject({ kind: "image", mime: "image/png", alt: "散点图" });
    expect(planMime(bundleOf(byId.jpeg?.outputs, "jpeg").data)).toMatchObject({ kind: "image", mime: "image/jpeg", alt: "照片" });
    expect(planMime(bundleOf(byId.svg?.outputs, "svg").data)).toMatchObject({ kind: "image", mime: "image/svg+xml", alt: "色块" });

    expect(byId.stack?.outputs?.map((item) => item.outputType === "stream" ? item.text.trim() : item.outputType)).toEqual([
      "before",
      "display_data",
      "after",
    ]);

    const both = bundleOf(byId.both?.outputs, "both");
    expect(both.data["image/png"]).toBe(PNG);
    expect(planMime(both.data).kind).toBe("html");

    expect(byId.quiet?.outputs ?? []).toEqual([]);
    expect(byId.quiet?.stdout).toBe("");

    expect(planMime(bundleOf(byId.figure?.outputs, "figure").data)).toMatchObject({ kind: "image", mime: "image/png" });

    expect(byId.stderr?.outputs?.some((item) => item.outputType === "stream" && item.name === "stderr" && item.text.includes("warn"))).toBe(true);
    expect(byId.boom?.stdout).toContain("kept");
    expect(byId.boom?.error).toMatch(/RuntimeError/);
    expect(byId.boom?.outputs?.some((item) => item.outputType === "stream" && item.text.includes("kept"))).toBe(true);
    expect(byId.boom?.outputs?.some((item) => item.outputType === "error")).toBe(true);
  });

  it("keeps R cells as an edit-only message", async () => {
    const [cell] = await executeCells({
      ...pythonDoc([{ id: "r1", role: "code", source: "print(1)\n" }]),
      language: "r",
      kernel: "r-deseq2",
    });
    expect(cell?.error).toMatch(/Rscript/);
    expect(cell?.outputs?.[0]).toMatchObject({ outputType: "error" });
  });
});