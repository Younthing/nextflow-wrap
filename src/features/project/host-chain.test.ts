import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { indexModules } from "@/features/workflow/catalog";
import { hostChainWorkflow, writeHostChainInputs } from "@/features/workflow/host-chain-demo";
import { generateProject } from "./generate";
import { standaloneScript } from "./standalone";

const ROOT = "/tmp/nf-patterns/.nf-verify/host-chain";
const COLORS = "blue\ngreen\nred\n";
const ALPHA_SORTED = "apple\napple\nbanana\nbanana\ncherry\n";
const BETA_SORTED = "apple\ndate\ndate\nelder\n";
const CSV_ALPHA = "apple\nbanana\napple\ncherry\nbanana\n";


function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

describe("temporary host-command workflow", () => {
  it("chains patterns through real shell commands and checks their output", () => {
    writeHostChainInputs(ROOT);
    const doc = hostChainWorkflow(ROOT);
    const project = generateProject(doc, indexModules([]));
    const wf = project.files.find((file) => file.path === "main.nf")!.content;
    const cfg = project.files.find((file) => file.path === "conf/modules.config")!.content;

    expect(wf).toContain("TEMPORARY TEST MODULES");
    expect(wf).toContain("TEMPORARY TEST MODULE: CAT (builtin/test/cat)");
    expect(wf).not.toContain("include {");
    for (const command of ["cat $infile", "sort $infile", "uniq ", "head -n ${lines}", "tail -n ${lines}", "cut -f ${fields}", "grep -F", "tr 'a-z' 'A-Z'", "awk '{print \\$3}'", "paste ", "wc -l", "split -l ${lines}", "tee out.txt"]) {
      expect(wf).toContain(command);
    }
    expect(wf).toContain(".groupTuple(by: 0)");
    expect(wf).toContain(".join(");
    expect(wf).toContain(".combine(");
    expect(wf).toContain("by: 0");
    expect(wf).toContain(".collect()");
    expect(wf).toContain(".flatten()");
    expect(wf).toContain(".splitText(by: 1, file: true)");
    expect(wf).toContain(".buffer(size: 2, remainder: true)");
    expect(wf).toContain(".collectFile(name: 'counts.txt')");
    expect(wf).toContain("Channel.fromPath(");
    expect(wf).toContain("Channel.fromFilePairs(");
    expect(wf).toContain(".splitCsv(header: true)");
    expect(wf).toContain("Channel.from(1..2)");
    expect(wf).toContain("Channel.of([]).first()");
    expect(wf).toContain(".ifEmpty(");
    expect(wf.split("UNIQ.out.result").length).toBeGreaterThan(2);
    expect(cfg).toContain("errorStrategy = 'ignore'");
    expect(cfg).toContain("when = { true }");
    expect(cfg).toContain("when = { false }");
    expect(cfg).toContain("memory = { 1.GB }");
    expect(cfg).toContain('filename -> "colors_$filename"');
    expect(cfg).toContain("pattern: '*.log'");
    expect(cfg).toContain('path: { "${params.outdir}/sorted/${meta.id}" }');
    expect(cfg).toContain("withName: 'SORT'");
    expect(cfg).toContain("cpus   = { 1 }");

    const runDir = mkdtempSync(join("/tmp/nf-patterns/.nf-verify", "host-run-"));
    writeFileSync(join(runDir, "main.nf"), standaloneScript(doc, indexModules([])));
    writeFileSync(join(runDir, "modules.config"), cfg);
    writeFileSync(
      join(runDir, "shell.config"),
      [
        "process.executor = 'local'",
        `workDir = '${join(runDir, "work")}'`,
        "docker.enabled = false",
        "singularity.enabled = false",
        "podman.enabled = false",
        "apptainer.enabled = false",
        "conda.enabled = false",
        "trace {",
        "    enabled = true",
        "    overwrite = true",
        "    file = 'trace.txt'",
        "    fields = 'task_id,name,status,exit,memory,cpus'",
        "}",
        "",
      ].join("\n"),
    );
    const args = [
      "run",
      "main.nf",
      "-ansi-log",
      "false",
      "-work-dir",
      join(runDir, "work"),
      "-c",
      "modules.config",
      "-c",
      "shell.config",
      "--outdir",
      join(runDir, "results"),
      "--publish_dir_mode",
      "copy",
    ];
    expect(args).not.toContain("-profile");
    const result = spawnSync("nextflow", args, {
      cwd: runDir,
      encoding: "utf8",
      timeout: 180_000,
      env: { ...process.env, NXF_ANSI_LOG: "false", NXF_DISABLE_CHECK_LATEST: "true" },
    });
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    if (result.status !== 0) throw new Error(output);

    const results = join(runDir, "results");
    const text = (path: string) => readFileSync(join(results, path), "utf8");
    expect(text("text/colors_out.txt")).toBe(COLORS);
    expect(text("upper/out.txt")).toBe("BLUE\nGREEN\nRED\n");
    expect(text("count/out.txt")).toBe("3\n");
    expect(text("matched/out.txt")).toBe("apple\tcherry\tblue\napple\tcherry\tred\napple\telder\tgreen\n");
    expect(text("logs/notes.log")).toBe("colors\n");
    expect(text("sorted/alpha/out.txt")).toBe(ALPHA_SORTED);
    expect(text("sorted/beta/out.txt")).toBe(BETA_SORTED);
    expect(text("pairs/alpha/out.txt")).toBe(ALPHA_SORTED);
    expect(text("pairs/beta/out.txt")).toBe(BETA_SORTED);
    expect(text("csv/alpha/out.txt")).toBe(CSV_ALPHA);
    expect(text("csv-count/alpha/out.txt")).toBe("5\n");
    expect(text("range/sample1/out.txt")).toBe("one\nA\n");
    expect(text("range/sample2/out.txt")).toBe("two\nB\n");
    expect(text("batches/out.txt")).toBe(COLORS);
    expect(text("chunks/out.txt")).toBe("1\n1\n1\n");
    expect(text("awk/out.txt")).toBe("blue\nred\ngreen\n");
    expect(output).toContain("Error is ignored");
    expect(output).not.toContain("Submitted process > UPPER_OFF");
    const trace = readFileSync(join(runDir, "trace.txt"), "utf8");
    const wc = trace.split("\n").find((line) => line.split("\t")[1] === "WC");
    expect(wc, trace).toMatch(/\t1 GB\t/);
    expect(walk(results).some((file) => file.endsWith("side.txt"))).toBe(false);
  }, 180_000);
});
