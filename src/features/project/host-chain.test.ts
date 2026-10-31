import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import catalog from "@/data/nf-core-modules.json";
import { indexModules } from "@/features/workflow/catalog";
import { SAMPLESHEET_ID } from "@/features/workflow/builtins";
import {
  BUFFER_ID,
  COLLECT_FILE_ID,
  COLLECT_ID,
  COMBINE_ID,
  CREATE_KEY_ID,
  CSV_ID,
  FILE_PAIRS_ID,
  FILE_PATH_ID,
  FILE_RANGE_ID,
  FLATTEN_ID,
  GROUP_ID,
  JOIN_ID,
  SPLIT_TEXT_ID,
} from "@/features/workflow/operators";
import {
  TEST_CAT_FILES_ID,
  TEST_CAT_ID,
  TEST_CAT_PAIR_ID,
  TEST_CUT_FILES_ID,
  TEST_GREP_FILES_ID,
  TEST_SORT_FILES_ID,
  TEST_SORT_ID,
  TEST_SPLIT_FILES_ID,
  TEST_TEE_FILES_ID,
  TEST_TR_FILES_ID,
  TEST_UNIQ_ID,
  TEST_WC_FILES_ID,
  TEST_WC_ID,
  TEST_HEAD_ID,
  TEST_PASTE_ID,
  TEST_TAIL_ID,
  TEST_AWK_FILES_ID,
} from "@/features/workflow/test-modules";
import type { ModuleCatalog, WorkflowDoc, WorkflowEdge, WorkflowNode, WorkflowNodeData } from "@/features/workflow/types";
import { generateProject } from "./generate";
import { standaloneScript } from "./standalone";

const typed = catalog as ModuleCatalog;
const ROOT = "/tmp/nf-patterns/.nf-verify/host-chain";
const COLORS = "blue\ngreen\nred\n";
const ALPHA_SORTED = "apple\napple\nbanana\nbanana\ncherry\n";
const BETA_SORTED = "apple\ndate\ndate\nelder\n";
const CSV_ALPHA = "apple\nbanana\napple\ncherry\nbanana\n";

function node(id: string, moduleId: string, alias: string, x: number, data: Partial<WorkflowNodeData> = {}): WorkflowNode {
  return {
    id,
    position: { x, y: 0 },
    data: { moduleId, alias, widgets: {}, config: {}, ...data },
  };
}

let edgeCount = 0;
function edge(source: string, sourcePort: string, target: string, targetPort: string): WorkflowEdge {
  edgeCount += 1;
  return { id: `h${edgeCount}`, source, target, sourceHandle: `out:${sourcePort}`, targetHandle: `in:${targetPort}` };
}

function workflow(dir: string): WorkflowDoc {
  const nodes: WorkflowNode[] = [
    node("samples", SAMPLESHEET_ID, "SAMPLESHEET", 0),
    node("files", FILE_PATH_ID, "FILES", 100, { settings: { glob: `${dir}/*_{1,2}.txt` } }),
    node("keys", CREATE_KEY_ID, "KEYS", 200, { settings: { separator: "_", index: 0 } }),
    node("groups", GROUP_ID, "GROUPS", 300),
    node("cat", TEST_CAT_ID, "CAT", 400),
    node("sort", TEST_SORT_ID, "SORT", 500, {
      config: { label: "process_single", publishPath: "${params.outdir}/sorted/${meta.id}" },
    }),
    node("uniq", TEST_UNIQ_ID, "UNIQ", 600),
    node("head", TEST_HEAD_ID, "HEAD", 700, { widgets: { lines: 1 } }),
    node("tail", TEST_TAIL_ID, "TAIL", 720, { widgets: { lines: 1 } }),
    node("join", JOIN_ID, "JOINED", 800),
    node("paste", TEST_PASTE_ID, "PASTE", 900),
    node("extras", FILE_PATH_ID, "EXTRAS", 100, { settings: { glob: `${dir}/extra_*.txt` } }),
    node("extraKeys", CREATE_KEY_ID, "EXTRA_KEYS", 200, { settings: { separator: "_", index: 1 } }),
    node("combine", COMBINE_ID, "COMBINED", 1000),
    node("pasteExtra", TEST_PASTE_ID, "PASTE_EXTRA", 1100),
    node("collect", COLLECT_ID, "COLLECTED", 1200),
    node("catAll", TEST_CAT_FILES_ID, "CAT_ALL", 1300),
    node("sorted", TEST_SORT_FILES_ID, "SORTED", 1400),
    node("cut", TEST_CUT_FILES_ID, "CUT", 1500, {
      widgets: { fields: 3 },
      config: { publishDirs: [{ path: "${params.outdir}/logs", pattern: "*.log" }] },
    }),
    node("awk", TEST_AWK_FILES_ID, "AWK", 1500, { config: { publishPath: "${params.outdir}/awk" } }),
    node("colors", TEST_SORT_FILES_ID, "COLORS", 1600, {
      config: {
        publishPath: "${params.outdir}/text",
        publishSaveAs: 'filename -> "colors_$filename"',
      },
    }),
    node("grep", TEST_GREP_FILES_ID, "GREP", 1700, {
      widgets: { pattern: "apple" },
      config: { publishPath: "${params.outdir}/matched" },
    }),
    node("grepFail", TEST_GREP_FILES_ID, "GREP_FAIL", 1720, {
      widgets: { pattern: "zzzz" },
      settings: { strict: true },
      config: { errorStrategy: "ignore" },
    }),
    node("upper", TEST_TR_FILES_ID, "UPPER", 1700, {
      config: { when: "true", publishPath: "${params.outdir}/upper" },
    }),
    node("upperOff", TEST_TR_FILES_ID, "UPPER_OFF", 1720, { config: { when: "false" } }),
    node("tee", TEST_TEE_FILES_ID, "TEE", 1700, { config: { optionalOutputs: "side" } }),
    node("side", COLLECT_ID, "SIDE", 1800),
    node("splitCmd", TEST_SPLIT_FILES_ID, "SPLIT_CMD", 1700, { widgets: { lines: 1 } }),
    node("flat", FLATTEN_ID, "FLAT", 1800),
    node("buffer", BUFFER_ID, "BATCH", 1900, { settings: { size: 2 } }),
    node("batchCat", TEST_CAT_FILES_ID, "BATCH_CAT", 2000),
    node("batchCollect", COLLECT_ID, "BATCH_COLLECT", 2100),
    node("batchJoin", TEST_CAT_FILES_ID, "BATCH_JOIN", 2200),
    node("batchSort", TEST_SORT_FILES_ID, "BATCH_SORT", 2300, { config: { publishPath: "${params.outdir}/batches" } }),
    node("chunks", SPLIT_TEXT_ID, "CHUNKS", 1700, { settings: { size: 1, file: true } }),
    node("wcChunk", TEST_WC_FILES_ID, "WC_CHUNK", 1800),
    node("countFile", COLLECT_FILE_ID, "COUNT_FILE", 1900, { settings: { name: "counts.txt" } }),
    node("teeCounts", TEST_TEE_FILES_ID, "TEE_COUNTS", 2000, { config: { publishPath: "${params.outdir}/chunks" } }),
    node("wc", TEST_WC_FILES_ID, "WC", 1700, {
      config: { memory: "1.GB", publishPath: "${params.outdir}/count" },
    }),
    node("pairs", FILE_PAIRS_ID, "PAIRS", 100, { settings: { glob: `${dir}/*_{1,2}.txt` } }),
    node("catPairs", TEST_CAT_ID, "CAT_PAIRS", 200),
    node("sortPairs", TEST_SORT_ID, "SORT_PAIRS", 300, { config: { publishPath: "${params.outdir}/pairs/${meta.id}" } }),
    node("table", CSV_ID, "TABLE", 100, {
      settings: { glob: `${dir}/table.csv`, id: "sampleId", read1: "read1", read2: "read2" },
    }),
    node("catTable", TEST_CAT_PAIR_ID, "CAT_TABLE", 200, { config: { publishPath: "${params.outdir}/csv/${meta.id}" } }),
    node("span", FILE_RANGE_ID, "SPAN", 100, {
      settings: {
        start: 1,
        end: 2,
        prefix: "sample",
        left: `${dir}/span/n.{n}.txt`,
        right: `${dir}/span/m.{n}.txt`,
      },
    }),
    node("catSpan", TEST_CAT_PAIR_ID, "CAT_SPAN", 200, { config: { publishPath: "${params.outdir}/range/${meta.id}" } }),
    node("wcTable", TEST_WC_ID, "WC_TABLE", 300, { config: { publishPath: "${params.outdir}/csv-count/${meta.id}" } }),
  ];
  const edges: WorkflowEdge[] = [
    edge("files", "files", "keys", "item"),
    edge("keys", "keyed", "groups", "items"),
    edge("groups", "grouped", "cat", "input"),
    edge("cat", "result", "sort", "input"),
    edge("sort", "result", "uniq", "input"),
    edge("uniq", "result", "head", "input"),
    edge("uniq", "result", "tail", "input"),
    edge("head", "result", "join", "left"),
    edge("tail", "result", "join", "right"),
    edge("join", "left", "paste", "left"),
    edge("join", "right", "paste", "right"),
    edge("extras", "files", "extraKeys", "item"),
    edge("extraKeys", "keyed", "combine", "right"),
    edge("paste", "result", "combine", "left"),
    edge("combine", "left", "pasteExtra", "left"),
    edge("combine", "right", "pasteExtra", "right"),
    edge("pasteExtra", "result", "collect", "items"),
    edge("collect", "collected", "catAll", "input"),
    edge("catAll", "result", "sorted", "input"),
    edge("sorted", "result", "cut", "input"),
    edge("sorted", "result", "awk", "input"),
    edge("cut", "result", "colors", "input"),
    edge("sorted", "result", "grep", "input"),
    edge("sorted", "result", "grepFail", "input"),
    edge("colors", "result", "upper", "input"),
    edge("colors", "result", "upperOff", "input"),
    edge("colors", "result", "tee", "input"),
    edge("tee", "side", "side", "items"),
    edge("colors", "result", "splitCmd", "input"),
    edge("splitCmd", "parts", "flat", "items"),
    edge("flat", "file", "buffer", "items"),
    edge("buffer", "batch", "batchCat", "input"),
    edge("batchCat", "result", "batchCollect", "items"),
    edge("batchCollect", "collected", "batchJoin", "input"),
    edge("batchJoin", "result", "batchSort", "input"),
    edge("colors", "result", "chunks", "file"),
    edge("chunks", "chunk", "wcChunk", "input"),
    edge("wcChunk", "result", "countFile", "items"),
    edge("countFile", "file", "teeCounts", "input"),
    edge("colors", "result", "wc", "input"),
    edge("pairs", "pairs", "catPairs", "input"),
    edge("catPairs", "result", "sortPairs", "input"),
    edge("table", "records", "catTable", "pair"),
    edge("catTable", "result", "wcTable", "input"),
    edge("span", "range", "catSpan", "pair"),
  ];
  return {
    id: "host",
    name: "host chain",
    version: 1,
    nodes,
    edges,
    params: { input: "samplesheet.csv", outdir: "results" },
    project: { name: "studio/hostchain", version: "1.0.0", author: "test" },
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function writeInputs(dir: string) {
  mkdirSync(join(dir, "span"), { recursive: true });
  const files: Record<string, string> = {
    "alpha_1.txt": "apple\nbanana\napple\n",
    "alpha_2.txt": "cherry\nbanana\n",
    "beta_1.txt": "date\napple\n",
    "beta_2.txt": "date\nelder\n",
    "extra_alpha_red.txt": "red\n",
    "extra_alpha_blue.txt": "blue\n",
    "extra_beta_green.txt": "green\n",
    "span/n.1.txt": "one\n",
    "span/n.2.txt": "two\n",
    "span/m.1.txt": "A\n",
    "span/m.2.txt": "B\n",
  };
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  writeFileSync(
    join(dir, "table.csv"),
    `sampleId,read1,read2\nalpha,${join(dir, "alpha_1.txt")},${join(dir, "alpha_2.txt")}\n`,
  );
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

describe("temporary host-command workflow", () => {
  it("chains patterns through real shell commands and checks their output", () => {
    writeInputs(ROOT);
    const doc = workflow(ROOT);
    const project = generateProject(doc, indexModules([]), { modulesSha: typed.gitSha });
    const wf = project.files.find((file) => file.path === "workflows/hostchain.nf")!.content;
    const cfg = project.files.find((file) => file.path === "conf/modules.config")!.content;

    expect(wf).toContain("TEMPORARY TEST MODULES — not nf-core");
    expect(wf).toContain("TEMPORARY TEST MODULE: CAT (builtin/test/cat) — not nf-core");
    expect(wf).not.toContain("modules/nf-core/test");
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
