import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { convertNotebook, scriptFileName } from "./convert";
import { executeCells, executeTryRun } from "./execute";
import { SAMPLE_PDF } from "@/features/output/samples";
import { planMime } from "./mime";
import { demoNotebooks } from "./seed";
import { simulateTryRun } from "./simulate";
import type { PortBindingRequest } from "./input-bindings";
import type { CellOutput, NotebookCell, NotebookDoc } from "./types";

const qc = () => demoNotebooks().find((doc) => doc.id === "qc_summary")!;

const qcBindings: PortBindingRequest[] = [
  { port: "fastq_zip", source: "sample", value: "fastqc-pair" },
  { port: "min_q", source: "path", value: "30" },
  { port: "title", source: "path", value: "QC 汇总" },
];

describe("executeTryRun", () => {
  it("runs the generated qc_summary CLI and checks output files", async () => {
    const notebook = qc();
    const scriptName = scriptFileName(convertNotebook(notebook).entry);
    const record = await executeTryRun(notebook, qcBindings);
    expect(record.exitCode).toBe(0);
    expect(record.passed).toBe(true);
    expect(record.outputs.map((output) => [output.name, output.ok])).toEqual([
      ["report", true],
      ["stats", true],
    ]);
    expect(record.log).not.toContain("explore");
    expect(record.envVia).toBe("host");
    expect(record.condaYaml).toBeUndefined();
    expect(record.containerImage).toBeUndefined();
    expect(record.log).toContain("未设置 conda / container");
    expect(record.log).toContain("选用本机 python3");
    expect(record.log).toContain("输入 fastq_zip · 样例 · 内置样例：2 个 FastQC zip");
    expect(record.log).toContain("输入 min_q · 路径 · 30");
    expect(record.log).toContain("输入 title · 路径 · QC 汇总");
    expect(record.bindings?.map((binding) => [binding.port, binding.source])).toEqual([
      ["fastq_zip", "sample"],
      ["min_q", "path"],
      ["title", "path"],
    ]);
    expect(record.log).toContain(`$ python3 ${scriptName} `);
    expect(record.log).not.toContain("main.py");
    const demo = simulateTryRun(notebook, qcBindings);
    const commandLine = (log: string) => log.split("\n").find((line) => line.startsWith("$"));
    expect(demo.log.split("\n")[0]).toBe(record.log.split("\n")[0]);
    expect(commandLine(demo.log)).toBe(commandLine(record.log));
    expect(demo.envVia).toBe("host");
  });
});

const shimPath = fileURLToPath(new URL("../../../scripts/e2e-docker-shim.sh", import.meta.url));

async function fakeConda(dir: string): Promise<{ bin: string; log: string }> {
  const log = join(dir, "conda.log");
  const bin = join(dir, "conda");
  const quoted = log.replaceAll("'", "'\\''");
  await writeFile(bin, `#!/bin/sh
printf '%s\\n' "$*" >> '${quoted}'
if [ "$1" = "env" ] || [ "$1" = "create" ]; then
  exit 0
fi
while [ "$#" -gt 0 ]; do
  if [ "$1" = "python3" ] || [ "$1" = "Rscript" ]; then
    exec "$@"
  fi
  shift
done
echo "conda shim: no interpreter" >&2
exit 1
`);
  await chmod(bin, 0o755);
  return { bin, log };
}

describe("executeTryRun module environment", () => {
  it("runs through the container named on the module and keeps the conda path in the log", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nb-env-"));
    try {
      const yaml = join(dir, "py311-pandas.yml");
      await writeFile(yaml, "name: py311-pandas\ndependencies:\n  - python\n");
      const conda = await fakeConda(dir);
      await chmod(shimPath, 0o755);
      const record = await executeTryRun(qc(), qcBindings, {
        condaYaml: yaml,
        containerImage: "python:3.11-slim",
      }, {
        cacheDir: join(dir, "cache"),
        tools: {
          conda: { bin: conda.bin, kind: "conda" },
          container: { bin: shimPath, kind: "docker" },
        },
      });
      expect(record.passed).toBe(true);
      expect(record.envVia).toBe("container");
      expect(record.condaYaml).toBe(yaml);
      expect(record.containerImage).toBe("python:3.11-slim");
      expect(record.log).toContain(`conda '${yaml}'`);
      expect(record.log).toContain("选用 container 'python:3.11-slim'");
      expect(record.log).toContain("e2e docker shim: image python:3.11-slim");
      expect(record.log).toContain("试跑选用容器");
      expect(record.log).not.toContain("选用本机");
      await expect(readFile(conda.log, "utf8")).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("uses the conda yaml when no container runtime is available", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nb-conda-"));
    try {
      const yaml = join(dir, "py.yml");
      await writeFile(yaml, "name: py\n");
      const conda = await fakeConda(dir);
      const record = await executeTryRun(qc(), qcBindings, {
        condaYaml: `  ${yaml}  `,
        containerImage: "python:3.11-slim",
      }, {
        cacheDir: join(dir, "cache"),
        tools: { conda: { bin: conda.bin, kind: "conda" } },
      });
      expect(record.passed).toBe(true);
      expect(record.envVia).toBe("conda");
      expect(record.condaYaml).toBe(yaml);
      expect(record.log).toContain(`选用 conda '${yaml}'`);
      expect(record.log).toContain("未找到容器运行时");
      expect(record.log).not.toContain("选用本机");
      const trace = await readFile(conda.log, "utf8");
      expect(trace).toContain(yaml);
      expect(trace).toContain("--no-capture-output");
      expect(trace).toContain("python3");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not fall back to the host interpreter when the requested runtime is missing", async () => {
    const notebook = qc();
    const missing = await executeTryRun(notebook, qcBindings, {
      containerImage: "python:3.11-slim",
    }, { tools: {} });
    expect(missing.passed).toBe(false);
    expect(missing.envVia).toBeUndefined();
    expect(missing.log).toContain("未找到容器运行时");
    expect(missing.log).toContain("container 'python:3.11-slim'");
    expect(missing.log).not.toContain("选用本机");
    expect(missing.log).not.toContain("$ python3");

    const absent = await executeTryRun(notebook, qcBindings, {
      condaYaml: "/tmp/nextflow-wrap-missing-env.yml",
      containerImage: "python:3.11-slim",
    }, { tools: { container: { bin: shimPath, kind: "docker" } } });
    expect(absent.passed).toBe(false);
    expect(absent.log).toContain("找不到 conda 文件");
    expect(absent.log).not.toContain("e2e docker shim");
  });
});

describe("executeTryRun own data", () => {
  const hello = () => demoNotebooks().find((doc) => doc.id === "hello_py")!;

  it("runs an uploaded samplesheet and a sample fixture", async () => {
    const csv = Buffer.from("sample,fastq_1\nUploaded,a.fq\n").toString("base64");
    const uploaded = await executeTryRun(hello(), [{ port: "samplesheet", source: "upload", files: [{ name: "mine.csv", contentBase64: csv }] }]);
    expect(uploaded.passed).toBe(true);
    expect(uploaded.bindings).toEqual([{ port: "samplesheet", source: "upload", label: "mine.csv" }]);
    expect(uploaded.log).toContain("输入 samplesheet · 上传 · mine.csv");
    expect(uploaded.log).toContain("--samplesheet mine.csv");

    const sample = await executeTryRun(hello(), [{ port: "samplesheet", source: "sample", value: "samplesheet" }]);
    expect(sample.passed).toBe(true);
    expect(sample.log).toContain("输入 samplesheet · 样例 · 内置样例：samplesheet.csv");
  });

  it("copies a host path into the work directory before the CLI runs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nb-own-"));
    const csvPath = join(dir, "sheet.csv");
    await writeFile(csvPath, "sample,fastq_1\nHost,a.fq\n");
    try {
      const record = await executeTryRun(hello(), [{ port: "samplesheet", source: "path", value: csvPath }]);
      expect(record.passed).toBe(true);
      expect(record.log).toContain(`输入 samplesheet · 路径 · ${csvPath} → sheet.csv`);
      expect(record.log).toContain("--samplesheet sheet.csv");
      expect(record.bindings?.[0]?.source).toBe("path");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps a missing path string and reports the failure in the log", async () => {
    const record = await executeTryRun(hello(), [{ port: "samplesheet", source: "path", value: "missing.csv" }]);
    expect(record.passed).toBe(false);
    expect(record.log).toContain("输入 samplesheet · 路径 · missing.csv");
    expect(record.log).toContain("--samplesheet missing.csv");
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
        id: "sheet",
        role: "code",
        source: [
          "class Sheet:",
          "    def _repr_csv_(self):",
          "        return 'sample,reads\\nS1,10\\n'",
          "    def __repr__(self):",
          "        return 'sheet'",
          "Sheet()",
          "",
        ].join("\n"),
      },
      {
        id: "pdf",
        role: "code",
        source: [
          "import base64",
          "class Doc:",
          "    def _repr_pdf_(self):",
          `        return base64.b64decode('${SAMPLE_PDF}')`,
          "    def __repr__(self):",
          "        return '报告'",
          "Doc()",
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
    expect(planMime(bundleOf(byId.sheet?.outputs, "sheet").data)).toMatchObject({
      kind: "table",
      columns: ["sample", "reads"],
      rows: [["S1", "10"]],
    });
    expect(planMime(bundleOf(byId.pdf?.outputs, "pdf").data)).toMatchObject({ kind: "pdf", title: "报告" });

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