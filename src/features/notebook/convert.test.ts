import { describe, expect, it } from "vitest";

import { createNode } from "@/features/workflow/nodes";
import type { ModuleDef } from "@/features/workflow/types";
import { convertNotebook, inputPorts, scriptFileName, tryRunArgv, tryRunCommand } from "./convert";
import { countCellChanges } from "./changes";
import { demoNotebooks, demoRevisions } from "./seed";
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
    expect(scriptFileName(converted.entry)).toBe("qc_summary.py");
    expect(converted.commandPreview.startsWith("qc_summary.py")).toBe(true);
  });

  it("names the script after the notebook, not main.py", () => {
    expect(scriptFileName(convertNotebook(demoNotebooks().find((doc) => doc.id === "hello_py")!).entry)).toBe("hello.py");
    expect(scriptFileName(convertNotebook(demoNotebooks().find((doc) => doc.id === "deseq2_plot")!).entry)).toBe("deseq2_plot.R");
    expect(tryRunCommand("r", "bin/deseq2_plot.R", ["--counts", "counts.tsv"])).toBe("Rscript deseq2_plot.R --counts counts.tsv");
    expect(tryRunCommand("python", "bin/qc_summary.py")).toBe("python3 qc_summary.py");
    const renamed = convertNotebook(qc(), "bin/custom_entry.py");
    expect(scriptFileName(renamed.entry)).toBe("custom_entry.py");
    expect(renamed.commandPreview.startsWith("custom_entry.py")).toBe(true);
  });

  it("builds file sockets and value widgets", () => {
    const converted = convertNotebook(qc());
    const ports = {
      inputs: converted.inputs,
    };
    expect(ports.inputs.find((input) => input.name === "min_q")?.type).toBe("int");
    expect(converted.script.startsWith("#!/usr/bin/env python3")).toBe(true);
  });

  it("starts canvas widgets at the notebook's declared defaults", () => {
    const inputs = inputPorts(convertNotebook(qc()).inputs);
    expect(inputs.find((port) => port.name === "min_q")).toMatchObject({ widget: "integer", default: 30 });
    expect(inputs.find((port) => port.name === "title")).toMatchObject({ widget: "string", default: "QC 汇总" });
    const def = { id: "script/qc_summary/v1", process: "QC_SUMMARY", inputs, outputs: [] } as unknown as ModuleDef;
    expect(createNode(def, { x: 0, y: 0 }, []).data.widgets).toEqual({ min_q: 30, title: "QC 汇总" });
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
    const notebooks = demoNotebooks();
    const latest = notebooks.find((doc) => doc.id === "qc_summary")!;
    const pinned = demoRevisions(notebooks).find((rev) => rev.notebookId === "qc_summary" && rev.rev === 12)!;
    expect(countCellChanges(pinned.cells, latest.cells)).toBe(3);
  });
});
