import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { demoNotebooks } from "./seed";
import { simulateTryRun } from "./simulate";
import { stageInputPlan } from "./input-bindings-stage";
import {
  bytesLabel,
  decodeUpload,
  defaultInputDraft,
  planTryRunInputs,
  safeUploadName,
  samplesForInput,
} from "./input-bindings";
import type { MarkerInput } from "./types";

const input = (name: string, type: string, extra?: Partial<MarkerInput>): MarkerInput => ({
  name,
  type,
  required: extra?.required ?? true,
  defaultValue: extra?.defaultValue,
});

describe("try-run input samples", () => {
  it("offers a fixture only when the port type has one", () => {
    expect(samplesForInput(input("fastq_zip", "path[]")).map((sample) => sample.id)).toEqual(["fastqc-pair"]);
    expect(samplesForInput(input("reads", "file[]"))).toEqual([]);
    expect(samplesForInput(input("samplesheet", "path")).map((sample) => sample.id)).toEqual(["samplesheet"]);
    expect(samplesForInput(input("table", "csv")).map((sample) => sample.id)).toEqual(["samplesheet"]);
    expect(samplesForInput(input("counts", "path")).map((sample) => sample.id)).toEqual(["counts-tsv"]);
    expect(samplesForInput(input("design", "path")).map((sample) => sample.id)).toEqual(["design-csv"]);
    expect(samplesForInput(input("account", "path"))).toEqual([]);
    expect(samplesForInput(input("min_q", "int", { required: false, defaultValue: "30" }))).toEqual([]);
    expect(samplesForInput(input("title", "str", { required: false, defaultValue: "S1" }))).toEqual([]);
    expect(defaultInputDraft(input("fastq_zip", "path[]")).source).toBe("sample");
    expect(defaultInputDraft(input("title", "str", { required: false, defaultValue: "S1" }))).toMatchObject({
      source: "path",
      path: "S1",
    });
  });
});

describe("planTryRunInputs", () => {
  const ports = [
    input("fastq_zip", "path[]"),
    input("samplesheet", "path"),
    input("min_q", "int", { required: false, defaultValue: "30" }),
    input("title", "str", { required: false, defaultValue: "QC 汇总" }),
  ];

  it("keeps upload, path, and sample on the ports that chose them", () => {
    const csv = Buffer.from("sample,fastq_1\nS1,a.fq\n").toString("base64");
    const plan = planTryRunInputs(ports, [
      { port: "fastq_zip", source: "sample", value: "fastqc-pair" },
      { port: "samplesheet", source: "upload", files: [{ name: "../mine.csv", contentBase64: csv }] },
      { port: "min_q", source: "path", value: "30" },
      { port: "title", source: "path", value: "QC 汇总" },
    ]);
    expect(plan.lines).toEqual([
      "输入 fastq_zip · 样例 · 内置样例：2 个 FastQC zip",
      "输入 samplesheet · 上传 · mine.csv",
      "输入 min_q · 路径 · 30",
      "输入 title · 路径 · QC 汇总",
    ]);
    expect(plan.values.samplesheet).toBe("mine.csv");
    expect(plan.files.map((file) => file.name)).toEqual(["S1_fastq.zip", "S2_fastq.zip", "mine.csv"]);
    expect(new TextDecoder().decode(plan.files[2]?.bytes)).toBe("sample,fastq_1\nS1,a.fq\n");
    expect(plan.paths.map((path) => path.port)).toEqual([]);
  });

  it("rejects a value port upload, a missing file, and a duplicated name", () => {
    expect(() => planTryRunInputs([input("title", "str", { required: false })], [
      { port: "title", source: "upload", files: [{ name: "a.txt", contentBase64: "YQ==" }] },
    ])).toThrow(/不能上传文件/);
    expect(() => planTryRunInputs([input("samplesheet", "path")], [
      { port: "samplesheet", source: "upload", files: [] },
    ])).toThrow(/还没有上传文件/);
    expect(() => planTryRunInputs([input("samplesheet", "path")], [
      { port: "samplesheet", source: "sample", value: "fastqc-pair" },
    ])).toThrow(/没有样例/);
    expect(() => planTryRunInputs([input("reads", "path[]")], [
      {
        port: "reads",
        source: "upload",
        files: [
          { name: "a.txt", contentBase64: "YQ==" },
          { name: "../a.txt", contentBase64: "Yg==" },
        ],
      },
    ])).toThrow(/文件名冲突/);
    expect(() => safeUploadName("..")).toThrow(/无效/);
    expect(safeUploadName("样本.csv")).toBe("样本.csv");
    expect(bytesLabel(1_000_000)).toBe("1 MB");
    expect(bytesLabel(1_200_000)).toBe("1.2 MB");
    expect(decodeUpload("YQ==", "reads")).toEqual(new Uint8Array([97]));
    expect(() => decodeUpload("!!!!", "reads")).toThrow(/无效/);
  });

  it("leaves an unbound port as an empty path", () => {
    const plan = planTryRunInputs([input("title", "str", { required: false })]);
    expect(plan.records).toEqual([{ port: "title", source: "path", label: "（空）" }]);
    expect(plan.values).toEqual({});
  });
});

describe("stageInputPlan", () => {
  it("copies an existing path into the work directory and records the source", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nb-bind-"));
    const work = join(dir, "work");
    await mkdir(work);
    const csvPath = join(dir, "sheet.csv");
    await writeFile(csvPath, "sample,fastq_1\nUp,a.fq\n");
    try {
      const plan = planTryRunInputs([input("samplesheet", "path")], [
        { port: "samplesheet", source: "path", value: csvPath },
      ]);
      const staged = await stageInputPlan(work, plan, ["hello.py"]);
      expect(staged.values.samplesheet).toBe("sheet.csv");
      expect(staged.records[0]).toEqual({
        port: "samplesheet",
        source: "path",
        label: `${csvPath} → sheet.csv`,
      });
      await expect(readFile(join(work, "sheet.csv"), "utf8")).resolves.toContain("Up");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("leaves a missing path as the typed string", async () => {
    const work = await mkdtemp(join(tmpdir(), "nb-miss-"));
    try {
      const plan = planTryRunInputs([input("samplesheet", "path")], [
        { port: "samplesheet", source: "path", value: "missing.csv" },
      ]);
      const staged = await stageInputPlan(work, plan);
      expect(staged.values.samplesheet).toBe("missing.csv");
      expect(staged.lines[0]).toBe("输入 samplesheet · 路径 · missing.csv");
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });
});

describe("simulateTryRun bindings", () => {
  it("names each port source in the demo log", () => {
    const hello = demoNotebooks().find((doc) => doc.id === "hello_py")!;
    const record = simulateTryRun(hello, [{ port: "samplesheet", source: "sample", value: "samplesheet" }]);
    expect(record.passed).toBe(true);
    expect(record.log).toContain("输入 samplesheet · 样例 · 内置样例：samplesheet.csv");
    expect(record.bindings).toEqual([
      { port: "samplesheet", source: "sample", label: "内置样例：samplesheet.csv" },
    ]);
    expect(record.log).toContain("--samplesheet samplesheet.csv");
  });
});
