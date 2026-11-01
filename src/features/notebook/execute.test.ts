import { describe, expect, it } from "vitest";

import { convertNotebook, scriptFileName } from "./convert";
import { executeCells, executeTryRun } from "./execute";
import { demoNotebooks } from "./seed";
import { simulateTryRun } from "./simulate";

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
});