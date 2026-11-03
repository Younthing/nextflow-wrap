import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { convertNotebook, scriptFileName } from "./convert";
import { CommandError } from "@/features/project/server/command";
import { executeCells, executeTryRun, type TryRunExecOptions } from "./execute";
import { SAMPLE_PDF } from "@/features/output/samples";
import { planMime } from "./mime";
import { fixtureNotebooks } from "./test-fixtures";
import { simulateTryRun } from "./simulate";
import type { PortBindingRequest } from "./input-bindings";
import type { CellOutput, NotebookCell, NotebookDoc } from "./types";

/** Real `nextflow module run` starts a JVM per try-run. */
const NEXTFLOW_TIMEOUT = 120_000;

const qc = () => fixtureNotebooks().find((doc) => doc.id === "qc_summary")!;

const qcBindings: PortBindingRequest[] = [
  { port: "fastq_zip", source: "sample", value: "fastqc-pair" },
  { port: "min_q", source: "path", value: "30" },
  { port: "title", source: "path", value: "QC 汇总" },
];

describe("executeTryRun", () => {
  it("runs the generated qc_summary module with nextflow module run and checks output files", async () => {
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
    expect(record.log).toContain("Nextflow 模块测试：modules/local/qc_summary");
    expect(record.log).toContain("$ nextflow module run local/qc_summary --fastq_zip inputs/");
    expect(record.log).not.toContain(`$ python3 ${scriptName}`);
    expect(record.log).not.toContain("main.py");
    const demo = simulateTryRun(notebook, qcBindings);
    const commandLine = (log: string) => log.split("\n").find((line) => line.startsWith("$"));
    expect(demo.log.split("\n")[0]).toBe(record.log.split("\n")[0]);
    expect(commandLine(demo.log)).toBe(commandLine(record.log));
    expect(demo.envVia).toBe("host");
  }, NEXTFLOW_TIMEOUT);
});

/** A stand-in for `nextflow module run`: records the call and the draft module, then writes the outputs. */
function fakeNextflow(outputs: Record<string, string> = { report: "qc_report.html", stats: "qc_stats.tsv" }) {
  const calls: { args: string[]; cwd: string; env: NodeJS.ProcessEnv; config: string; main: string }[] = [];
  const run = async (_bin: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) => {
    const cwd = options.cwd ?? "";
    const target = args[args.indexOf("run") + 1];
    calls.push({
      args,
      cwd,
      env: options.env ?? process.env,
      config: await readFile(join(cwd, "nextflow.config"), "utf8"),
      main: await readFile(join(cwd, "modules", target, "main.nf"), "utf8"),
    });
    const task = join(cwd, "work", "ab", "cdef");
    await mkdir(task, { recursive: true });
    await writeFile(join(task, ".command.out"), "fake task stdout\n");
    const reported: Record<string, string> = {};
    for (const [name, file] of Object.entries(outputs)) {
      await writeFile(join(task, file), "ok\n");
      reported[name] = join(task, file);
    }
    return `Nextflow 26.10.5 is available\n${JSON.stringify(reported, null, 4)}\n`;
  };
  return { calls, run: run as unknown as NonNullable<TryRunExecOptions["run"]>, nextflow: { bin: "nextflow", env: { ...process.env, PATH: "/usr/bin" } } };
}

describe("executeTryRun module environment", () => {
  it("enables the container engine for the draft module and keeps the conda path in the log", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nb-env-"));
    try {
      const yaml = join(dir, "py311-pandas.yml");
      await writeFile(yaml, "name: py311-pandas\ndependencies:\n  - python\n");
      const fake = fakeNextflow();
      const record = await executeTryRun(qc(), qcBindings, {
        condaYaml: yaml,
        containerImage: "python:3.11-slim",
      }, {
        cacheDir: join(dir, "cache"),
        run: fake.run,
        nextflow: fake.nextflow,
        tools: {
          conda: { bin: "/opt/conda/bin/conda", kind: "conda" },
          container: { bin: "/opt/tools/podman", kind: "podman" },
        },
      });
      expect(record.passed).toBe(true);
      expect(record.envVia).toBe("container");
      expect(record.condaYaml).toBe(yaml);
      expect(record.containerImage).toBe("python:3.11-slim");
      expect(record.log).toContain(`conda '${yaml}'`);
      expect(record.log).toContain("选用 container 'python:3.11-slim'");
      expect(record.log).toContain("试跑选用容器");
      expect(record.log).toContain("fake task stdout");
      expect(record.log).not.toContain("选用本机");
      const [call] = fake.calls;
      expect(call.args.slice(0, 4)).toEqual(["-q", "module", "run", "local/qc_summary"]);
      expect(call.args).toContain("-output-format");
      expect(call.config).toContain("nextflow.enable.moduleBinaries = true");
      expect(call.config).toContain("podman.enabled = true");
      expect(call.config).not.toContain("conda.enabled");
      expect(call.main).toContain("container 'python:3.11-slim'");
      expect(call.env.PATH?.startsWith("/opt/tools")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("uses the conda yaml when no container runtime is available", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nb-conda-"));
    try {
      const yaml = join(dir, "py.yml");
      await writeFile(yaml, "name: py\n");
      const fake = fakeNextflow();
      const record = await executeTryRun(qc(), qcBindings, {
        condaYaml: `  ${yaml}  `,
        containerImage: "python:3.11-slim",
      }, {
        cacheDir: join(dir, "cache"),
        run: fake.run,
        nextflow: fake.nextflow,
        tools: { conda: { bin: "/opt/mm/bin/micromamba", kind: "micromamba" } },
      });
      expect(record.passed).toBe(true);
      expect(record.envVia).toBe("conda");
      expect(record.condaYaml).toBe(yaml);
      expect(record.log).toContain(`选用 conda '${yaml}'`);
      expect(record.log).toContain("未找到容器运行时");
      expect(record.log).not.toContain("选用本机");
      const [call] = fake.calls;
      expect(call.config).toContain("conda.enabled = true");
      expect(call.config).toContain("conda.useMicromamba = true");
      expect(call.main).toContain(`conda '${yaml}'`);
      expect(call.env.NXF_CONDA_CACHEDIR).toBe(join(dir, "cache"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fails with the Nextflow log when the module exits non-zero", async () => {
    const run = (async () => {
      throw new CommandError("nextflow exited with 1", 1, "ERROR ~ Error executing process > 'QC_SUMMARY'\nTraceback: boom");
    }) as unknown as NonNullable<TryRunExecOptions["run"]>;
    const record = await executeTryRun(qc(), qcBindings, undefined, { run, nextflow: { bin: "nextflow", env: process.env } });
    expect(record.passed).toBe(false);
    expect(record.exitCode).toBe(1);
    expect(record.log).toContain("Traceback: boom");
    expect(record.outputs.every((output) => !output.ok)).toBe(true);
  });

  it("does not run when the requested runtime is missing", async () => {
    const notebook = qc();
    const fake = fakeNextflow();
    const missing = await executeTryRun(notebook, qcBindings, {
      containerImage: "python:3.11-slim",
    }, { tools: {}, run: fake.run, nextflow: fake.nextflow });
    expect(missing.passed).toBe(false);
    expect(missing.envVia).toBeUndefined();
    expect(missing.log).toContain("未找到容器运行时");
    expect(missing.log).toContain("container 'python:3.11-slim'");
    expect(missing.log).not.toContain("选用本机");
    expect(missing.log).not.toContain("$ nextflow");

    const absent = await executeTryRun(notebook, qcBindings, {
      condaYaml: "/tmp/nextflow-wrap-missing-env.yml",
      containerImage: "python:3.11-slim",
    }, { tools: { container: { bin: "/usr/bin/docker", kind: "docker" } }, run: fake.run, nextflow: fake.nextflow });
    expect(absent.passed).toBe(false);
    expect(absent.log).toContain("找不到 conda 文件");
    expect(fake.calls).toHaveLength(0);
  });
});

describe("executeTryRun own data", () => {
  const hello = () => fixtureNotebooks().find((doc) => doc.id === "hello_py")!;

  it("runs an uploaded samplesheet and a sample fixture", async () => {
    const csv = Buffer.from("sample,fastq_1\nUploaded,a.fq\n").toString("base64");
    const uploaded = await executeTryRun(hello(), [{ port: "samplesheet", source: "upload", files: [{ name: "mine.csv", contentBase64: csv }] }]);
    expect(uploaded.passed).toBe(true);
    expect(uploaded.bindings).toEqual([{ port: "samplesheet", source: "upload", label: "mine.csv" }]);
    expect(uploaded.log).toContain("输入 samplesheet · 上传 · mine.csv");
    expect(uploaded.log).toContain("--samplesheet inputs/mine.csv");

    const sample = await executeTryRun(hello(), [{ port: "samplesheet", source: "sample", value: "samplesheet" }]);
    expect(sample.passed).toBe(true);
    expect(sample.log).toContain("输入 samplesheet · 样例 · 内置样例：samplesheet.csv");
  }, NEXTFLOW_TIMEOUT);

  it("copies a host path into the work directory before the module runs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nb-own-"));
    const csvPath = join(dir, "sheet.csv");
    await writeFile(csvPath, "sample,fastq_1\nHost,a.fq\n");
    try {
      const record = await executeTryRun(hello(), [{ port: "samplesheet", source: "path", value: csvPath }]);
      expect(record.passed).toBe(true);
      expect(record.log).toContain(`输入 samplesheet · 路径 · ${csvPath} → sheet.csv`);
      expect(record.log).toContain("--samplesheet inputs/sheet.csv");
      expect(record.bindings?.[0]?.source).toBe("path");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, NEXTFLOW_TIMEOUT);

  it("reads a relative path such as data/sample.csv from the project workspace", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "nb-ws-"));
    await mkdir(join(workspace, "data"));
    await writeFile(join(workspace, "data", "sample.csv"), "sample,fastq_1\nWs,a.fq\n");
    try {
      const record = await executeTryRun(hello(), [{ port: "samplesheet", source: "path", value: "data/sample.csv" }], undefined, { workspace });
      expect(record.passed).toBe(true);
      expect(record.log).toContain("输入 samplesheet · 路径 · data/sample.csv → sample.csv");
      expect(record.log).toContain("--samplesheet inputs/sample.csv");

      const missing = await executeTryRun(hello(), [{ port: "samplesheet", source: "path", value: "data/missing.csv" }], undefined, { workspace });
      expect(missing.passed).toBe(false);
      expect(missing.log).toContain("工作区里没有 data/missing.csv");
      expect(missing.log).not.toContain("$ nextflow");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }, NEXTFLOW_TIMEOUT);

  it("fails before running when a path does not exist", async () => {
    const record = await executeTryRun(hello(), [{ port: "samplesheet", source: "path", value: "/tmp/nextflow-wrap-missing.csv" }]);
    expect(record.passed).toBe(false);
    expect(record.log).toContain("输入 samplesheet · 路径 · /tmp/nextflow-wrap-missing.csv");
    expect(record.log).toContain("找不到文件：/tmp/nextflow-wrap-missing.csv");
  });
});

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const JPEG = "/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYwLjMxLjEwMgD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABMAAEBAAAAAAAAAAAAAAAAAAAABgEBAQAAAAAAAAAAAAAAAAAABgcQAQAAAAAAAAAAAAAAAAAAAAARAQAAAAAAAAAAAAAAAAAAAAD/wAARCAAIAAgDASIAAhEAAxEA/9oADAMBAAIRAxEAPwCLAFF/f//Z";

function pythonDoc(cells: NotebookCell[]): NotebookDoc {
  return {
    id: "rich",
    projectId: "example",
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
describe("notebook cells and the workspace", () => {
  it("run in the project folder, so workspace paths such as data/x.csv resolve", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "nb-workspace-"));
    try {
      await writeFile(join(workspace, "reads.txt"), "ACGT\n");
      const results = await executeCells(pythonDoc([{ id: "read", role: "code", source: "print(open('reads.txt').read().strip())\n" }]), undefined, workspace);
      expect(results[0]?.stdout).toBe("ACGT\n");
      // The driver keeps its own files out of the workspace.
      expect((await readdir(workspace)).sort()).toEqual(["reads.txt"]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
