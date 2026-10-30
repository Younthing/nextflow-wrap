import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Verify biological tool output, not just the Nextflow exit code. */
export async function verifyQcExecution(directory: string, options = { workflowName: "QCSMOKE", shortName: "qcsmoke", counts: { FASTQC: 2, MULTIQC: 1 } as Record<string, number> }) {
  const reports = ["SINGLE", "PAIRED_1", "PAIRED_2"];
  for (const sample of reports) {
    for (const extension of ["html", "zip"]) {
      const path = join(directory, "results/fastqc", `${sample}_fastqc.${extension}`);
      if ((await stat(path)).size === 0) throw new Error(`Empty FastQC report: ${path}`);
    }
  }
  const multiqcDir = join(directory, "results/multiqc");
  const multiqcFiles = await readdir(multiqcDir, { recursive: true });
  const dataPath = multiqcFiles.find((path) => path.endsWith("multiqc_fastqc.txt"));
  const reportPath = multiqcFiles.find((path) => path.endsWith(".html"));
  if (!dataPath || !reportPath || !(await stat(join(multiqcDir, reportPath))).size) throw new Error("MultiQC report/data missing");
  const [header, ...rows] = (await readFile(join(multiqcDir, dataPath), "utf8")).trim().split("\n").map((line) => line.split("\t"));
  const sampleIndex = header.indexOf("Sample");
  const countIndex = header.indexOf("Total Sequences");
  if (sampleIndex < 0 || countIndex < 0 || rows.length !== reports.length) throw new Error("Unexpected MultiQC FastQC table");
  for (const sample of reports) {
    const row = rows.find((row) => row[sampleIndex] === sample);
    if (!row || Number(row[countIndex]) !== 200) throw new Error(`MultiQC must contain 200 real reads for ${sample}`);
  }
  const trace = await readFile(join(directory, "results/pipeline_info/execution_trace_smoke.txt"), "utf8");
  const [fields, ...tasks] = trace.trim().split("\n").map((line) => line.split("\t"));
  const field = (row: string[], name: string) => row[fields.indexOf(name)];
  const expected = new Set([`${options.workflowName}:FASTQC:SINGLE`, `${options.workflowName}:FASTQC:PAIRED`, `${options.workflowName}:MULTIQC:${options.shortName}`]);
  const expectedTotal = Object.values(options.counts).reduce((sum, count) => sum + count, 0);
  if (tasks.length !== expectedTotal) throw new Error(`Unexpected task count: ${tasks.length}`);
  const counts: Record<string, number> = {};
  for (const row of tasks) {
    expected.delete(`${field(row, "process")}:${field(row, "tag")}`);
    counts[field(row, "process")] = (counts[field(row, "process")] ?? 0) + 1;
    if (field(row, "status") !== "COMPLETED" || field(row, "exit") !== "0") {
      throw new Error(`Unexpected task trace:\n${trace}`);
    }
  }
  if (expected.size || Object.entries(options.counts).some(([alias, count]) => counts[`${options.workflowName}:${alias}`] !== count)) throw new Error(`Unexpected process/tag counts: ${JSON.stringify(counts)}`);
  const verification = { succeeded: true, fastqcReports: 3, tasks: tasks.length, readsPerFile: 200, samples: ["SINGLE", "PAIRED"], verifiedAt: new Date().toISOString() };
  await writeFile(join(directory, "verification.json"), `${JSON.stringify(verification, null, 2)}\n`);
  return verification;
}
