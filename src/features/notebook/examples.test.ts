import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { indexModules } from "@/features/workflow/catalog";
import { validateWorkflow } from "@/features/workflow/validate";
import { jupyterPythonCandidates } from "./server/kernels";
import { exampleData, exampleLibraryCopies, exampleModules, exampleNotebooks, exampleWorkflow } from "./examples";
import { notebookFromLibrary } from "./library-copy";

/** A Python with the libraries the examples use (CI installs them; see .github/workflows/ci.yml). */
function analysisPython(): string {
  const found = jupyterPythonCandidates().find((python) => spawnSync(python, ["-c", "import pandas, matplotlib, scipy"], { stdio: "ignore" }).status === 0);
  if (!found) throw new Error("需要装有 pandas、matplotlib、scipy 的 python3");
  return found;
}

describe("example project", () => {
  const modules = exampleModules();
  const dir = mkdtempSync(join(tmpdir(), "nfs-examples-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("wires the four modules into a valid workflow with several inputs, parameters and outputs each", () => {
    const issues = validateWorkflow(exampleWorkflow().nodes, exampleWorkflow().edges, exampleWorkflow().params, indexModules(modules)).filter((issue) => issue.level === "error");
    expect(issues).toEqual([]);
    for (const def of modules) {
      expect(def.inputs.filter((port) => !port.widget).length).toBeGreaterThanOrEqual(2);
      expect(def.outputs.length).toBeGreaterThanOrEqual(def.id === "script/summary_report" ? 1 : 3);
    }
    expect(modules.find((module) => module.id === "script/group_compare")!.inputs.filter((port) => port.widget).map((port) => port.name)).toEqual(["group_col", "reference", "alpha", "top_n"]);
  });

  it("opens each module's saved notebook copy for editing", () => {
    const copies = exampleLibraryCopies();
    const notebook = notebookFromLibrary(copies[0]!, "nb_edit", "example");
    expect(notebook.cells).toEqual(exampleNotebooks()[0]!.cells);
    expect(notebook.fromModuleId).toBe("script/count_qc");
  });

  it("runs the generated scripts end to end on the example data, as Nextflow would", () => {
    const python = analysisPython();
    for (const file of exampleData()) {
      mkdirSync(dirname(join(dir, file.path)), { recursive: true });
      writeFileSync(join(dir, file.path), file.content);
    }
    const run = (id: string, args: string[]) => {
      const def = modules.find((item) => item.id === `script/${id}`)!;
      const task = join(dir, id);
      mkdirSync(task, { recursive: true });
      writeFileSync(join(task, "script.py"), def.script!);
      const result = spawnSync(python, ["script.py", ...args], { cwd: task, encoding: "utf8", env: { ...process.env, MPLBACKEND: "Agg" } });
      expect(result.status, result.stderr).toBe(0);
      return task;
    };
    const qc = run("count_qc", ["--counts", join(dir, "data/counts.tsv"), "--samples", join(dir, "data/samples.csv")]);
    const kept = readFileSync(join(qc, "filtered_counts.tsv"), "utf8").trim().split("\n").length - 1;
    expect(kept).toBeGreaterThan(200);
    expect(kept).toBeLessThan(300);
    const pca = run("normalize_pca", ["--counts", join(qc, "filtered_counts.tsv"), "--samples", join(dir, "data/samples.csv")]);
    const de = run("group_compare", ["--normalized", join(pca, "normalized.tsv"), "--samples", join(dir, "data/samples.csv")]);
    const top = readFileSync(join(de, "top_genes.tsv"), "utf8").trim().split("\n").slice(1).map((line) => line.split("\t")[0]!);
    // Genes 1–30 go up and 31–50 go down in the example data: the top hits come from those.
    expect(top.length).toBeGreaterThan(5);
    expect(top.every((gene) => Number(gene.slice(4)) <= 50)).toBe(true);
    const report = run("summary_report", [
      "--metrics", join(qc, "qc_metrics.tsv"), "--scores", join(pca, "pca_scores.tsv"), "--results", join(de, "group_compare.tsv"),
      "--qc_plot", join(qc, "qc_library_size.png"), "--pca_plot", join(pca, "pca.png"), "--volcano", join(de, "volcano.png"),
    ]);
    const html = readFileSync(join(report, "report.html"), "utf8");
    expect(html).toContain("表达分析报告");
    expect(html.match(/data:image\/png;base64/g)).toHaveLength(3);
    // Four Python processes that each import pandas, SciPy and matplotlib: seconds apiece on a busy CI runner.
  }, 60_000);
});
