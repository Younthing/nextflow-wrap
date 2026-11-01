import { describe, expect, it } from "vitest";

import { convertNotebook, tryRunArgv } from "./convert";
import { demoNotebooks, qcPinnedCellChanges } from "./seed";
import type { NotebookDoc } from "./types";

const qc = () => demoNotebooks().find((doc) => doc.id === "qc_summary")!;

describe("convertNotebook", () => {
  it("turns markers into a CLI and drops explore cells", () => {
    const converted = convertNotebook(qc());
    expect(converted.inputs.map((input) => input.name)).toEqual(["fastq_zip", "min_q", "title"]);
    expect(converted.outputs.map((output) => [output.name, output.pattern])).toEqual([
      ["report", "report.html"],
      ["stats", "stats.tsv"],
    ]);
    expect(converted.included.map((cell) => cell.index)).toEqual([1, 2, 4]);
    expect(converted.excluded.map((cell) => cell.role)).toEqual(["explore"]);
    expect(converted.script).toContain('p.add_argument("--fastq_zip", nargs="+", required=True)');
    expect(converted.script).toContain("p.add_argument(\"--min_q\", type=int, default=30)");
    expect(converted.script).toContain("fastq_zip = args.fastq_zip");
    expect(converted.script).not.toContain("samples/S1_fastq.zip");
    expect(converted.script).toContain("[3] 自由探索已排除");
    expect(converted.script).not.toContain("print(\"explore\"");
    expect(converted.script).toContain("open(\"report.html\"");
    expect(converted.commandPreview).toContain("--min_q 30");
  });

  it("builds file sockets and value widgets", () => {
    const converted = convertNotebook(qc());
    const ports = {
      inputs: converted.inputs,
    };
    expect(ports.inputs.find((input) => input.name === "min_q")?.type).toBe("int");
    expect(converted.script.startsWith("#!/usr/bin/env python3")).toBe(true);
  });

  it("rejects a missing output pattern", () => {
    const doc: NotebookDoc = {
      ...qc(),
      cells: [{ id: "c", role: "output", source: "# @output name=report type=path\n" }],
    };
    expect(() => convertNotebook(doc)).toThrow(/pattern/);
  });

  it("splits list arguments", () => {
    const converted = convertNotebook(qc());
    expect(tryRunArgv(converted.inputs, { fastq_zip: "S1_fastq.zip,S2_fastq.zip", title: "QC 汇总" })).toEqual([
      "--fastq_zip",
      "S1_fastq.zip",
      "S2_fastq.zip",
      "--title",
      "QC 汇总",
    ]);
  });
});

describe("seed revisions", () => {
  it("counts three cell edits since the pinned qc_summary publish", () => {
    expect(qcPinnedCellChanges()).toBe(3);
  });
});
