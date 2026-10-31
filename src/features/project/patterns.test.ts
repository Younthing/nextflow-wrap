import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import catalog from "@/data/nf-core-modules.json";
import { indexModules } from "@/features/workflow/catalog";
import { REFERENCE_ID, SAMPLESHEET_ID } from "@/features/workflow/builtins";
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
import type { ChannelElement, ModuleCatalog, ModuleDef, PortDef, WorkflowDoc, WorkflowEdge, WorkflowNode } from "@/features/workflow/types";
import { generateProject } from "./generate";
import { standaloneScript } from "./standalone";

const typed = catalog as ModuleCatalog;
const VERIFY = "/tmp/nf-patterns/.nf-verify";
const INPUTS = join(VERIFY, "inputs");

const meta = (name = "meta"): ChannelElement => ({ name, type: "map", kind: "meta", description: "" });
const fileEl = (name: string): ChannelElement => ({ name, type: "file", kind: "file", description: "" });
const valueEl = (name: string): ChannelElement => ({ name, type: "string", kind: "value", description: "" });
const port = (name: string, elements: ChannelElement[]): PortDef => ({ name, description: "", elements });

function moduleOf(id: string, process: string, inputs: PortDef[], outputs: PortDef[] = [port("out", [fileEl("out")])]): ModuleDef {
  return {
    id: `nf-core/${id}`,
    path: id,
    name: process,
    process,
    category: "工具",
    description: process,
    keywords: [],
    tools: [],
    inputs,
    outputs,
  };
}

const sink = moduleOf("sink", "SINK", [port("x", [fileEl("x")])]);
const metaSink = moduleOf("metasink", "SINK", [port("x", [meta(), fileEl("file")])]);
const pairSink = moduleOf("pair", "PAIR", [
  port("left", [meta("meta"), fileEl("left")]),
  port("right", [meta("meta2"), fileEl("right")]),
]);
const pass = moduleOf("pass", "PASS", [port("x", [fileEl("x")])], [port("x", [fileEl("x")])]);
const touch = moduleOf("touch", "TOUCH", [], [port("files", [fileEl("files")])]);
const valProc = moduleOf("val", "VAL", [port("x", [valueEl("x")])], []);
const sourceVal = moduleOf("source", "SOURCE", [], [port("x", [valueEl("x")])]);
const reader = moduleOf("reader", "READER", [port("reads", [fileEl("reads")])]);
const tagged = moduleOf("tagged", "TAGGED", [port("reads", [meta(), fileEl("reads")])]);
const triple = moduleOf("triple", "TRIPLE", [port("row", [meta(), fileEl("read1"), fileEl("read2")])]);

function sheet(): WorkflowNode {
  return {
    id: "samples",
    position: { x: 0, y: 0 },
    data: { moduleId: SAMPLESHEET_ID, alias: "SAMPLESHEET", widgets: {}, config: {} },
  };
}

function node(
  id: string,
  moduleId: string,
  alias: string,
  x: number,
  data: Partial<WorkflowNode["data"]> = {},
): WorkflowNode {
  return {
    id,
    position: { x, y: 80 },
    data: { moduleId, alias, widgets: {}, config: {}, ...data },
  };
}

let edgeId = 0;
function edge(source: string, sourcePort: string, target: string, targetPort: string): WorkflowEdge {
  edgeId += 1;
  return {
    id: `e${edgeId}`,
    source,
    target,
    sourceHandle: `out:${sourcePort}`,
    targetHandle: `in:${targetPort}`,
  };
}

function workflow(nodes: WorkflowNode[], edges: WorkflowEdge[], params: WorkflowDoc["params"] = {}): WorkflowDoc {
  return {
    id: "wf",
    name: "patterns",
    version: 1,
    nodes: [sheet(), ...nodes],
    edges,
    params: { input: "samplesheet.csv", outdir: "results", ...params },
    project: { name: "studio/patterns", version: "1.0.0", author: "test" },
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function generated(doc: WorkflowDoc, modules: ModuleDef[]) {
  const index = indexModules(modules);
  const project = generateProject(doc, index, { modulesSha: typed.gitSha });
  return {
    index,
    wf: project.files.find((file) => file.path === "workflows/patterns.nf")!.content,
    cfg: project.files.find((file) => file.path === "conf/modules.config")!.content,
    config: project.files.find((file) => file.path === "nextflow.config")!.content,
  };
}

function writeTree(files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
}

function walk(dir: string): string[] {
  if (!statExists(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function statExists(path: string) {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function run(doc: WorkflowDoc, modules: ModuleDef[], args: string[] = []) {
  mkdirSync(VERIFY, { recursive: true });
  const root = mkdtempSync(join(VERIFY, "run-"));
  const { index, cfg } = generated(doc, modules);
  writeFileSync(join(root, "main.nf"), standaloneScript(doc, index));
  writeFileSync(join(root, "modules.config"), cfg);
  writeFileSync(join(root, "sample.txt"), "sample-reads\n");
  const result = spawnSync(
    "nextflow",
    [
      "run",
      "main.nf",
      "-ansi-log",
      "false",
      "-work-dir",
      join(root, "work"),
      "-c",
      "modules.config",
      "--outdir",
      join(root, "results"),
      "--publish_dir_mode",
      "copy",
      "--sample",
      join(root, "sample.txt"),
      ...args,
    ],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 90_000,
      env: { ...process.env, NXF_ANSI_LOG: "false", NXF_DISABLE_CHECK_LATEST: "true" },
    },
  );
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0) throw new Error(output);
  return { output, root };
}

const tasks = (output: string, name: string) => output.split("\n").filter((line) => line.includes(`TASK ${name} `));

describe("nextflow patterns", () => {
  it("creates a key and combines one key with many records", () => {
    const dir = join(INPUTS, "combine");
    writeTree({
      [join(dir, "demux.Clontech_5p--bc1001_3p.flnc.sam")]: "sam1001\n",
      [join(dir, "demux.Clontech_5p--bc1002_3p.flnc.sam")]: "sam1002\n",
      [join(dir, "demux.Clontech_5p--bc1001_3p.flnc.fasta")]: "fa1001a\n",
      [join(dir, "demux.Clontech_5p--bc1001_3p.extra.fasta")]: "fa1001b\n",
      [join(dir, "demux.Clontech_5p--bc1002_3p.flnc.fasta")]: "fa1002\n",
    });
    const key = { separator: "--", index: 1, separator2: "_3p", index2: 0 };
    const doc = workflow(
      [
        node("sa", FILE_PATH_ID, "SAMS", 100, { settings: { glob: `${dir}/*.sam`, check: true } }),
        node("fa", FILE_PATH_ID, "FASTAS", 100, { settings: { glob: `${dir}/*.fasta`, check: true } }),
        node("ka", CREATE_KEY_ID, "KEY_SAM", 200, { settings: key }),
        node("kb", CREATE_KEY_ID, "KEY_FA", 200, { settings: key }),
        node("by", COMBINE_ID, "BY_KEY", 300),
        node("out", pairSink.id, "PAIR", 400),
      ],
      [
        edge("sa", "files", "ka", "item"),
        edge("fa", "files", "kb", "item"),
        edge("ka", "keyed", "by", "left"),
        edge("kb", "keyed", "by", "right"),
        edge("by", "left", "out", "left"),
        edge("by", "right", "out", "right"),
      ],
    );
    const { wf } = generated(doc, [pairSink]);
    expect(wf).toContain("split('--')[1]");
    expect(wf).toContain("split('_3p')[0]");
    expect(wf).toContain(".combine(");
    expect(wf).toContain("by: 0");
    expect(wf).not.toContain(".into(");
    const { output } = run(doc, [pairSink]);
    const lines = tasks(output, "PAIR");
    expect(lines.filter((line) => line.includes("bc1001"))).toHaveLength(2);
    expect(lines.filter((line) => line.includes("bc1002"))).toHaveLength(1);
    expect(lines.some((line) => line.includes("bc1001") && line.includes("bc1002"))).toBe(false);
  }, 120_000);

  it("joins one key to one record", () => {
    const dir = join(INPUTS, "join");
    writeTree({
      [join(dir, "sampleA_1.txt")]: "a\n",
      [join(dir, "sampleB_1.txt")]: "b\n",
      [join(dir, "sampleA_2.txt")]: "a2\n",
      [join(dir, "sampleB_2.txt")]: "b2\n",
      [join(dir, "sampleC_2.txt")]: "c2\n",
    });
    const doc = workflow(
      [
        node("l", FILE_PATH_ID, "LEFTS", 100, { settings: { glob: `${dir}/*_1.txt` } }),
        node("r", FILE_PATH_ID, "RIGHTS", 100, { settings: { glob: `${dir}/*_2.txt` } }),
        node("kl", CREATE_KEY_ID, "KEY_L", 200, { settings: { separator: "_", index: 0 } }),
        node("kr", CREATE_KEY_ID, "KEY_R", 200, { settings: { separator: "_", index: 0 } }),
        node("jn", JOIN_ID, "JOINED", 300),
        node("out", pairSink.id, "PAIR", 400),
      ],
      [
        edge("l", "files", "kl", "item"),
        edge("r", "files", "kr", "item"),
        edge("kl", "keyed", "jn", "left"),
        edge("kr", "keyed", "jn", "right"),
        edge("jn", "left", "out", "left"),
        edge("jn", "right", "out", "right"),
      ],
    );
    const { wf } = generated(doc, [pairSink]);
    expect(wf).toContain(".join(");
    expect(wf).toContain("by: 0");
    const lines = tasks(run(doc, [pairSink]).output, "PAIR");
    expect(lines).toHaveLength(2);
    expect(lines.some((line) => line.includes("sampleA") && line.includes("sampleC"))).toBe(false);
  }, 120_000);

  it("collects every upstream file into one task", () => {
    const dir = join(INPUTS, "collect");
    writeTree({
      [join(dir, "a.txt")]: "a\n",
      [join(dir, "b.txt")]: "b\n",
      [join(dir, "c.txt")]: "c\n",
    });
    const doc = workflow(
      [
        node("in", FILE_PATH_ID, "FILES", 100, { settings: { glob: `${dir}/*.txt` } }),
        node("col", COLLECT_ID, "ALL", 200),
        node("out", sink.id, "SINK", 300),
      ],
      [edge("in", "files", "col", "items"), edge("col", "collected", "out", "x")],
    );
    expect(generated(doc, [sink]).wf).toContain(".collect()");
    expect(tasks(run(doc, [sink]).output, "SINK")).toHaveLength(1);
  }, 120_000);

  it("groups files that share a key", () => {
    const dir = join(INPUTS, "group");
    writeTree({
      [join(dir, "sampleA_1.txt")]: "a1\n",
      [join(dir, "sampleA_2.txt")]: "a2\n",
      [join(dir, "sampleB_1.txt")]: "b1\n",
    });
    const doc = workflow(
      [
        node("in", FILE_PATH_ID, "FILES", 100, { settings: { glob: `${dir}/*.txt` } }),
        node("key", CREATE_KEY_ID, "KEY", 200, { settings: { separator: "_", index: 0 } }),
        node("grp", GROUP_ID, "GROUPS", 300),
        node("out", metaSink.id, "SINK", 400),
      ],
      [
        edge("in", "files", "key", "item"),
        edge("key", "keyed", "grp", "items"),
        edge("grp", "grouped", "out", "x"),
      ],
    );
    const { wf } = generated(doc, [metaSink]);
    expect(wf).toContain(".groupTuple(by: 0)");
    expect(wf).toContain("meta.id");
    const lines = tasks(run(doc, [metaSink]).output, "SINK");
    expect(lines).toHaveLength(2);
    expect(lines.some((line) => line.includes("sampleA_1.txt") && line.includes("sampleA_2.txt"))).toBe(true);
    expect(lines.some((line) => line.includes("sampleB_1.txt") && !line.includes("sampleA"))).toBe(true);
  }, 120_000);

  it("collects files into one file", () => {
    const dir = join(INPUTS, "collect-file");
    writeTree({
      [join(dir, "a.txt")]: "alpha\n",
      [join(dir, "b.txt")]: "beta\n",
      [join(dir, "c.txt")]: "gamma\n",
    });
    const doc = workflow(
      [
        node("in", FILE_PATH_ID, "FILES", 100, { settings: { glob: `${dir}/*.txt` } }),
        node("col", COLLECT_FILE_ID, "MERGED", 200, { settings: { name: "collected.txt" } }),
        node("out", sink.id, "SINK", 300),
      ],
      [edge("in", "files", "col", "items"), edge("col", "file", "out", "x")],
    );
    expect(generated(doc, [sink]).wf).toContain(".collectFile(name: 'collected.txt')");
    const { output, root } = run(doc, [sink]);
    expect(tasks(output, "SINK")).toHaveLength(1);
    const path = walk(root).find((file) => file.endsWith("collected.txt"));
    expect(path).toBeTruthy();
    const text = readFileSync(path!, "utf8");
    expect(text).toContain("alpha");
    expect(text).toContain("beta");
    expect(text).toContain("gamma");
  }, 120_000);

  it("mixes a disabled process input straight to the next process", () => {
    const dir = join(INPUTS, "skip-off");
    writeTree({ [join(dir, "kept.txt")]: "kept\n" });
    const doc = workflow(
      [
        node("in", FILE_PATH_ID, "FILES", 100, { settings: { glob: `${dir}/*.txt` } }),
        node("mid", pass.id, "PASS", 200, { disabled: true }),
        node("out", sink.id, "SINK", 300),
      ],
      [edge("in", "files", "mid", "x"), edge("mid", "x", "out", "x")],
    );
    const { wf } = generated(doc, [pass, sink]);
    expect(wf).not.toContain("PASS (");
    expect(wf).toContain("channel.empty().mix(");
    const { output } = run(doc, [pass, sink]);
    expect(tasks(output, "PASS")).toHaveLength(0);
    expect(tasks(output, "SINK").some((line) => line.includes("kept.txt"))).toBe(true);
  }, 120_000);

  it("skips a process at runtime and mixes its input downstream", () => {
    const dir = join(INPUTS, "skip-on");
    writeTree({ [join(dir, "kept.txt")]: "kept\n" });
    const doc = workflow(
      [
        node("in", FILE_PATH_ID, "FILES", 100, { settings: { glob: `${dir}/*.txt` } }),
        node("mid", pass.id, "PASS", 200, { config: { skip: true } }),
        node("out", sink.id, "SINK", 300),
      ],
      [edge("in", "files", "mid", "x"), edge("mid", "x", "out", "x")],
    );
    const { wf, config } = generated(doc, [pass, sink]);
    expect(wf).toContain("params.skip_pass?.toString() == 'true' ? channel.empty() :");
    expect(wf).toContain(".mix(ch_pass_bypass)");
    expect(config).toContain("skip_pass");
    const skipped = run(doc, [pass, sink], ["--skip_pass", "true"]);
    expect(tasks(skipped.output, "PASS")).toHaveLength(0);
    expect(tasks(skipped.output, "SINK").some((line) => line.includes("kept.txt"))).toBe(true);
    const ran = run(doc, [pass, sink]);
    expect(tasks(ran.output, "PASS").length).toBeGreaterThan(0);
    expect(tasks(ran.output, "SINK").some((line) => line.includes("x.txt"))).toBe(true);
  }, 120_000);

  it("flattens a multi-file output so each file is its own task", () => {
    const doc = workflow(
      [
        node("up", touch.id, "TOUCH", 100, { settings: { touch: "a.txt,b.txt" } }),
        node("flat", FLATTEN_ID, "FLAT", 200),
        node("out", sink.id, "SINK", 300),
      ],
      [edge("up", "files", "flat", "items"), edge("flat", "file", "out", "x")],
    );
    expect(generated(doc, [touch, sink]).wf).toContain(".flatten()");
    expect(tasks(run(doc, [touch, sink]).output, "SINK")).toHaveLength(2);
  }, 120_000);

  it("splits a text file into chunks", () => {
    const poem = join(INPUTS, "poem.txt");
    writeTree({ [poem]: "one\ntwo\nthree\nfour\nfive\n" });
    const doc = workflow(
      [
        node("in", FILE_PATH_ID, "POEM", 100, { settings: { glob: poem, check: true } }),
        node("split", SPLIT_TEXT_ID, "CHUNKS", 200, { settings: { size: 2, file: true } }),
        node("out", sink.id, "SINK", 300),
      ],
      [edge("in", "files", "split", "file"), edge("split", "chunk", "out", "x")],
    );
    expect(generated(doc, [sink]).wf).toContain(".splitText(by: 2, file: true)");
    expect(tasks(run(doc, [sink]).output, "SINK")).toHaveLength(3);
  }, 120_000);

  it("batches inputs with buffer", () => {
    const dir = join(INPUTS, "batch");
    writeTree(Object.fromEntries([1, 2, 3, 4, 5].map((n) => [join(dir, `n${n}.txt`), `${n}\n`])));
    const doc = workflow(
      [
        node("in", FILE_PATH_ID, "FILES", 100, { settings: { glob: `${dir}/*.txt` } }),
        node("batch", BUFFER_ID, "BATCH", 200, { settings: { size: 2 } }),
        node("out", sink.id, "SINK", 300),
      ],
      [edge("in", "files", "batch", "items"), edge("batch", "batch", "out", "x")],
    );
    expect(generated(doc, [sink]).wf).toContain(".buffer(size: 2, remainder: true)");
    expect(tasks(run(doc, [sink]).output, "SINK")).toHaveLength(3);
  }, 120_000);

  it("runs one task per CSV record", () => {
    const csv = join(INPUTS, "index.csv");
    writeTree({
      [join(INPUTS, "r1.fq")]: "r1\n",
      [join(INPUTS, "r2.fq")]: "r2\n",
      [join(INPUTS, "r3.fq")]: "r3\n",
      [join(INPUTS, "r4.fq")]: "r4\n",
      [csv]: `sampleId,read1,read2\nS1,${join(INPUTS, "r1.fq")},${join(INPUTS, "r2.fq")}\nS2,${join(INPUTS, "r3.fq")},${join(INPUTS, "r4.fq")}\n`,
    });
    const doc = workflow(
      [
        node("csv", CSV_ID, "ROWS", 100, { settings: { glob: csv, id: "sampleId", read1: "read1", read2: "read2" } }),
        node("out", triple.id, "TRIPLE", 200),
      ],
      [edge("csv", "records", "out", "row")],
    );
    const { wf } = generated(doc, [triple]);
    expect(wf).toContain(".splitCsv(header: true)");
    expect(wf).toContain("file(row['read1']");
    const lines = tasks(run(doc, [triple]).output, "TRIPLE");
    expect(lines).toHaveLength(2);
    expect(lines.some((line) => line.includes("S1"))).toBe(true);
    expect(lines.some((line) => line.includes("S2"))).toBe(true);
  }, 120_000);

  it("groups file pairs and can use a custom grouping expression", () => {
    const dir = join(INPUTS, "pairs");
    writeTree({
      [join(dir, "S1_1.fq")]: "a\n",
      [join(dir, "S1_2.fq")]: "b\n",
      [join(dir, "S2_1.fq")]: "c\n",
      [join(dir, "S2_2.fq")]: "d\n",
    });
    const doc = workflow(
      [
        node("in", FILE_PAIRS_ID, "PAIRS", 100, { settings: { glob: `${dir}/*_{1,2}.fq` } }),
        node("out", metaSink.id, "SINK", 200),
      ],
      [edge("in", "pairs", "out", "x")],
    );
    const custom = workflow(
      [node("in", FILE_PAIRS_ID, "PAIRS", 100, { settings: { glob: `${dir}/*.{bam,bai}`, grouping: "file -> file.name.replaceAll(/.bam|.bai$/, '')" } })],
      [],
    );
    expect(generated(doc, [metaSink]).wf).toContain("Channel.fromFilePairs(");
    expect(generated(custom, []).wf).toContain("file.name.replaceAll(/.bam|.bai$/, '')");
    const lines = tasks(run(doc, [metaSink]).output, "SINK");
    expect(lines).toHaveLength(2);
    expect(lines.some((line) => line.includes("S1"))).toBe(true);
    expect(lines.some((line) => line.includes("S2"))).toBe(true);
  }, 120_000);

  it("runs one task per file matching a glob", () => {
    const dir = join(INPUTS, "paths");
    writeTree({
      [join(dir, "S1_1.fq")]: "a\n",
      [join(dir, "S2_1.fq")]: "b\n",
      [join(dir, "S2_2.fq")]: "c\n",
    });
    const doc = workflow(
      [
        node("in", FILE_PATH_ID, "FILES", 100, { settings: { glob: `${dir}/*_1.fq` } }),
        node("out", sink.id, "SINK", 200),
      ],
      [edge("in", "files", "out", "x")],
    );
    expect(generated(doc, [sink]).wf).toContain("Channel.fromPath(");
    const lines = tasks(run(doc, [sink]).output, "SINK");
    expect(lines).toHaveLength(2);
    expect(lines.some((line) => line.includes("S2_2.fq"))).toBe(false);
  }, 120_000);

  it("expands a numeric range into one tuple per index", () => {
    const dir = join(INPUTS, "range");
    writeTree({
      [join(dir, "foo.1.indels.vcf")]: "i1\n",
      [join(dir, "foo.snvs.1.vcf")]: "s1\n",
      [join(dir, "foo.2.indels.vcf")]: "i2\n",
      [join(dir, "foo.snvs.2.vcf")]: "s2\n",
    });
    const doc = workflow(
      [
        node("range", FILE_RANGE_ID, "RANGE", 100, {
          settings: { start: 1, end: 2, prefix: "sample", left: `${dir}/foo.{n}.indels.vcf`, right: `${dir}/foo.snvs.{n}.vcf` },
        }),
        node("out", triple.id, "TRIPLE", 200),
      ],
      [edge("range", "range", "out", "row")],
    );
    const { wf } = generated(doc, [triple]);
    expect(wf).toContain("Channel.from(1..2)");
    expect(wf).toContain('id: "sample${n}"');
    const lines = tasks(run(doc, [triple]).output, "TRIPLE");
    expect(lines).toHaveLength(2);
    expect(lines.some((line) => line.includes("sample1"))).toBe(true);
    expect(lines.some((line) => line.includes("sample2"))).toBe(true);
  }, 120_000);

  it("feeds one channel to two processes without into", () => {
    const dir = join(INPUTS, "dup");
    writeTree({ [join(dir, "once.txt")]: "once\n" });
    const other = moduleOf("other", "OTHER", [port("x", [fileEl("x")])]);
    const doc = workflow(
      [
        node("in", FILE_PATH_ID, "FILES", 100, { settings: { glob: `${dir}/*.txt` } }),
        node("a", sink.id, "SINK", 200),
        node("b", other.id, "OTHER", 200),
      ],
      [edge("in", "files", "a", "x"), edge("in", "files", "b", "x")],
    );
    const { wf } = generated(doc, [sink, other]);
    expect(wf).not.toContain(".into(");
    expect(wf.split("ch_files").length).toBeGreaterThan(2);
    const { output } = run(doc, [sink, other]);
    expect(tasks(output, "SINK")).toHaveLength(1);
    expect(tasks(output, "OTHER")).toHaveLength(1);
  }, 120_000);

  it("emits [] for an unconnected secondary input and an empty optional file", () => {
    const dir = join(INPUTS, "optional-in");
    writeTree({ [join(dir, "seq.fa")]: "seq\n" });
    const two = moduleOf("two", "TWO", [port("seq", [fileEl("seq")]), port("opt", [fileEl("opt")])]);
    const doc = workflow(
      [
        node("in", FILE_PATH_ID, "FILES", 100, { settings: { glob: `${dir}/*.fa` } }),
        node("out", two.id, "TWO", 200),
        node("ref", REFERENCE_ID, "FILTER", 100, { settings: { param: "filter", format: "other", optional: true } }),
      ],
      [edge("in", "files", "out", "seq")],
    );
    const { wf } = generated(doc, [two]);
    expect(wf).toContain("Channel.of([]).first()");
    expect(wf).toMatch(/params\.filter \? channel\.value\(file\(params\.filter, checkIfExists: true\)\) : channel\.value\(\[\]\)/);
    expect(tasks(run(doc, [two]).output, "TWO").length).toBeGreaterThan(0);
  }, 120_000);

  it("uses ifEmpty so an optional output does not hang join or collect", () => {
    const side = moduleOf(
      "side",
      "SIDE",
      [port("reads", [meta(), fileEl("reads")])],
      [port("out", [meta(), fileEl("file")])],
    );
    const doc = workflow(
      [
        node("side", side.id, "SIDE", 100, { config: { optionalOutputs: "out" } }),
        node("col", COLLECT_ID, "ALL", 200),
        node("out", sink.id, "SINK", 300),
        node("left", side.id, "LEFT", 120),
        node("jn", JOIN_ID, "JOINED", 220),
      ],
      [
        edge("samples", "reads", "side", "reads"),
        edge("side", "out", "col", "items"),
        edge("col", "collected", "out", "x"),
        edge("samples", "reads", "left", "reads"),
        edge("left", "out", "jn", "left"),
        edge("side", "out", "jn", "right"),
      ],
    );
    const { wf } = generated(doc, [side, sink]);
    expect(wf).toContain(".ifEmpty(");
    expect(wf).toContain(".join(");
    expect(wf).toContain(".collect()");
    const { output } = run(doc, [side, sink], ["--omit_side", "true"]);
    expect(tasks(output, "SINK").length).toBeGreaterThan(0);
  }, 120_000);

  it("runs a process only when its input channel is empty", () => {
    const empty = workflow([node("val", valProc.id, "VAL", 100, { config: { whenEmpty: true } })], []);
    const { wf, cfg } = generated(empty, [valProc]);
    expect(wf).toContain("channel.empty().ifEmpty('EMPTY')");
    expect(cfg).toContain("when = { x == 'EMPTY' }");
    expect(tasks(run(empty, [valProc]).output, "VAL").some((line) => line.includes("EMPTY"))).toBe(true);

    const filled = workflow(
      [
        node("src", sourceVal.id, "SOURCE", 100, { settings: { emit: "DATA" } }),
        node("val", valProc.id, "VAL", 200, { config: { whenEmpty: true, when: "x == 'EMPTY'" } }),
      ],
      [edge("src", "x", "val", "x")],
    );
    const ran = run(filled, [sourceVal, valProc]);
    expect(tasks(ran.output, "SOURCE").length).toBeGreaterThan(0);
    expect(tasks(ran.output, "VAL")).toHaveLength(0);
  }, 120_000);

  it("ignores a failing process and keeps going", () => {
    const fail = moduleOf("fail", "FAIL", [], [port("out", [fileEl("out")])]);
    const ok = moduleOf("ok", "OK", [], [port("out", [fileEl("out")])]);
    const doc = workflow(
      [
        node("fail", fail.id, "FAIL", 100, { config: { errorStrategy: "ignore" } }),
        node("ok", ok.id, "OK", 200),
      ],
      [],
    );
    expect(generated(doc, [fail, ok]).cfg).toContain("errorStrategy = 'ignore'");
    const { output } = run(doc, [fail, ok], ["--fail_fail", "true"]);
    expect(output).toContain("Error is ignored");
    expect(tasks(output, "OK").length).toBeGreaterThan(0);
  }, 120_000);

  it("runs exactly one of two processes and mixes the result", () => {
    const foo = moduleOf("foo", "FOO", [], [port("files", [fileEl("files")])]);
    const bar = moduleOf("bar", "BAR", [], [port("files", [fileEl("files")])]);
    const doc = workflow(
      [
        node("foo", foo.id, "FOO", 100, { config: { when: "params.flag.toString() != 'true'" }, settings: { touch: "foo.txt" } }),
        node("bar", bar.id, "BAR", 100, { config: { when: "params.flag.toString() == 'true'" }, settings: { touch: "bar.txt" } }),
        node("out", sink.id, "SINK", 200),
      ],
      [edge("foo", "files", "out", "x"), edge("bar", "files", "out", "x")],
    );
    const { wf, cfg } = generated(doc, [foo, bar, sink]);
    expect(cfg).toContain("when = { params.flag.toString() != 'true' }");
    expect(cfg).toContain("when = { params.flag.toString() == 'true' }");
    expect(wf).toContain("channel.empty().mix(");
    const off = run(doc, [foo, bar, sink]);
    expect(tasks(off.output, "SINK").some((line) => line.includes("foo.txt"))).toBe(true);
    expect(tasks(off.output, "BAR")).toHaveLength(0);
    const on = run(doc, [foo, bar, sink], ["--flag", "true"]);
    expect(tasks(on.output, "SINK").some((line) => line.includes("bar.txt"))).toBe(true);
    expect(tasks(on.output, "FOO")).toHaveLength(0);
  }, 120_000);

  it("sets memory from the input file size", () => {
    const dir = join(INPUTS, "memory");
    writeTree({
      [join(dir, "small.fq")]: "tiny\n",
      [join(dir, "big.fq")]: `${"x".repeat(80_000)}\n`,
    });
    const doc = workflow(
      [
        node("in", FILE_PATH_ID, "FILES", 100, { settings: { glob: `${dir}/*.fq` } }),
        node("out", reader.id, "READER", 200, { config: { memory: "reads.size() < 70.KB ? 1.GB : 5.GB" } }),
      ],
      [edge("in", "files", "out", "reads")],
    );
    expect(generated(doc, [reader]).cfg).toContain("memory = { reads.size() < 70.KB ? 1.GB : 5.GB }");
    const lines = tasks(run(doc, [reader]).output, "READER");
    expect(lines.some((line) => line.includes("mem=1 GB"))).toBe(true);
    expect(lines.some((line) => line.includes("mem=5 GB"))).toBe(true);
  }, 120_000);

  it("publishes process outputs under a chosen directory", () => {
    const doc = workflow(
      [node("tag", tagged.id, "TAGGED", 200, { config: { publishPath: "${params.outdir}/${meta.id}" } })],
      [edge("samples", "reads", "tag", "reads")],
    );
    const { cfg } = generated(doc, [tagged]);
    expect(cfg).toContain('path: { "${params.outdir}/${meta.id}" }');
    const { root, output } = run(doc, [tagged]);
    expect(tasks(output, "TAGGED").length).toBeGreaterThan(0);
    expect(walk(join(root, "results")).some((path) => path.includes(`${join("S1", "out.txt")}`) || path.includes("/S1/"))).toBe(true);
  }, 120_000);

  it("publishes files into directories chosen by glob", () => {
    const doc = workflow(
      [
        node("up", touch.id, "TOUCH", 100, {
          settings: { touch: "sample_counts.txt,sample_outlook.txt,sample.fq" },
          config: {
            publishDirs: [
              { path: "${params.outdir}/counts", pattern: "*_counts.txt" },
              { path: "${params.outdir}/outlooks", pattern: "*_outlook.txt" },
              { path: "${params.outdir}/reads", pattern: "*.fq" },
            ],
          },
        }),
      ],
      [],
    );
    const { cfg } = generated(doc, [touch]);
    expect(cfg).toContain("pattern: '*_counts.txt'");
    expect(cfg).toContain("pattern: '*_outlook.txt'");
    expect(cfg).toContain("pattern: '*.fq'");
    const files = walk(join(run(doc, [touch]).root, "results"));
    expect(files.some((path) => path.includes("/counts/") && path.endsWith("sample_counts.txt"))).toBe(true);
    expect(files.some((path) => path.includes("/outlooks/") && path.endsWith("sample_outlook.txt"))).toBe(true);
    expect(files.some((path) => path.includes("/reads/") && path.endsWith("sample.fq"))).toBe(true);
  }, 120_000);

  it("renames files as it publishes them", () => {
    const doc = workflow(
      [
        node("up", touch.id, "TOUCH", 100, {
          settings: { touch: "this.txt,that.txt" },
          config: { publishSaveAs: 'filename -> "foo_$filename"' },
        }),
      ],
      [],
    );
    expect(generated(doc, [touch]).cfg).toContain('saveAs: { filename -> "foo_$filename" }');
    const files = walk(join(run(doc, [touch]).root, "results"));
    expect(files.some((path) => path.endsWith("foo_this.txt"))).toBe(true);
    expect(files.some((path) => path.endsWith("foo_that.txt"))).toBe(true);
  }, 120_000);
});
