import { describe, expect, it } from "vitest";

import { executeTryRun } from "./execute";
import { demoNotebooks } from "./seed";

describe("executeTryRun", () => {
  it("runs the generated qc_summary CLI and checks output files", async () => {
    const notebook = demoNotebooks().find((doc) => doc.id === "qc_summary")!;
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
  });
});