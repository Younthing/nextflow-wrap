import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import catalog from "../src/data/nf-core-modules.json";
import { generateProject } from "../src/features/project/generate";
import { gstr } from "../src/features/project/groovy";
import { smokeFastq } from "../src/features/project/smoke-data";
import { runCommand } from "../src/features/project/server/command";
import { installComponents, materializeProject } from "../src/features/project/server/materialize";
import { preflight } from "../src/features/project/server/preflight";
import { verifyQcExecution } from "../src/features/project/server/verify-qc";
import { indexModules } from "../src/features/workflow/catalog";
import { qcDemoWorkflow } from "../src/features/workflow/qc-demo";
import { demoRnaseqWorkflow } from "../src/features/workflow/demo";
import type { ModuleCatalog } from "../src/features/workflow/types";

async function main() {
  const flags = new Set(process.argv.slice(2));
  if ([...flags].some((flag) => !["--preflight", "--prepare-only", "--star"].includes(flag))) throw new Error("Usage: pnpm smoke:nextflow [--preflight | --prepare-only] [--star]");
  const tools = await preflight();
  console.log(JSON.stringify({ ...tools.versions, resources: tools.resources }, null, 2));
  if (flags.has("--preflight")) return;
  const dataRoot = resolve(process.env.NEXTFLOW_STUDIO_DATA_DIR ?? join(homedir(), ".local/share/nextflow-studio"));
  const directory = join(dataRoot, "smoke", new Date().toISOString().replaceAll(/[:.]/g, "-"));
  const typed = catalog as ModuleCatalog;
  const doc = flags.has("--star") ? demoRnaseqWorkflow("rnaseq-smoke") : qcDemoWorkflow();
  if (flags.has("--star")) {
    doc.project = { name: "studio/rnaseqsmoke", author: "Nextflow Studio", version: "1.0.0" };
    doc.params.fasta = join(directory, "assets/genome.fa");
    doc.params.gtf = join(directory, "assets/genes.gtf");
    doc.nodes.find((node) => node.id === "star_index")!.data.config.args = "--genomeSAindexNbases 3 --genomeChrBinNbits 8";
    // Keep synthetic reads intact so all three FastQC outputs can be checked against their input counts.
    doc.nodes.find((node) => node.id === "fastp")!.data.config.args = "--disable_adapter_trimming --disable_quality_filtering --disable_length_filtering";
  }
  const project = generateProject(doc, indexModules(typed.modules), { modulesSha: typed.gitSha });
  await materializeProject(project, directory);
  console.log(`Project: ${directory}`);
  await mkdir(join(directory, "assets/reads"));
  if (flags.has("--star")) {
    const genome = smokeFastq(47).split("\n").filter((_, index) => index % 4 === 1).join("");
    await writeFile(join(directory, "assets/genome.fa"), `>chrSynthetic\n${genome}\n`);
    await writeFile(join(directory, "assets/genes.gtf"), 'chrSynthetic\tstudio\texon\t101\t1000\t.\t+\t.\tgene_id "gene1"; transcript_id "transcript1";\n');
  }
  const fixtures: { path: string; sha256: string; reads: number }[] = [];
  for (const [name, seed, mate] of [["single_R1", 17, 1], ["paired_R1", 29, 1], ["paired_R2", 29, 2]] as const) {
    const bytes = gzipSync(smokeFastq(seed, mate));
    const path = `assets/reads/${name}.fastq.gz`;
    await writeFile(join(directory, path), bytes);
    fixtures.push({ path, sha256: createHash("sha256").update(bytes).digest("hex"), reads: 200 });
  }
  await writeFile(join(directory, "assets/samplesheet.csv"), [
    "sample,fastq_1,fastq_2",
    `SINGLE,${join(directory, fixtures[0].path)},`,
    `PAIRED,${join(directory, fixtures[1].path)},${join(directory, fixtures[2].path)}`,
    "",
  ].join("\n"));
  await writeFile(join(directory, "fixtures.json"), JSON.stringify({ source: "Nextflow Studio synthetic PRNG reads; no external data", fixtures }, null, 2));
  const params = { ...doc.params, input: join(directory, "assets/samplesheet.csv"), outdir: join(directory, "results"), custom_config_base: "", monochrome_logs: true, trace_report_suffix: "smoke" };
  await writeFile(join(directory, "params.json"), JSON.stringify(params, null, 2));
  await writeFile(join(directory, "workflow.json"), JSON.stringify(doc, null, 2));
  await writeFile(join(directory, "run.config"), [
    "process.executor = 'local'",
    `workDir = ${gstr(join(directory, "work"))}`,
    "executor.cpus = 2",
    "executor.memory = '4.GB'",
    "executor.queueSize = 2",
    "process.resourceLimits = [cpus: 2, memory: '2.GB', time: '10.m']",
    "trace.fields = 'task_id,hash,native_id,process,name,tag,status,exit,submit,start,complete,duration,realtime,cpus,%cpu,peak_rss,workdir'",
    "",
  ].join("\n"));
  await installComponents(project, directory, tools);
  const profiles = tools.resources.architecture === "aarch64" || tools.resources.architecture === "arm64" ? "test,docker,emulate_amd64" : "test,docker";
  const args = ["-log", "nextflow.log", "run", ".", "-ansi-log", "false", "-profile", profiles, "-c", "run.config", "-params-file", "params.json"];
  await writeFile(join(directory, "execution.json"), JSON.stringify({ executable: tools.nextflow, args, versions: tools.versions, resources: tools.resources }, null, 2));
  if (flags.has("--prepare-only")) return;
  const helloDir = join(directory, "hello");
  await mkdir(helloDir);
  await writeFile(join(helloDir, "main.nf"), "process HELLO {\n    output:\n    stdout\n    script:\n    'echo nextflow-studio-hello'\n}\nworkflow {\n    HELLO().view()\n}\n");
  const image = typed.modules.find((module) => module.id === "nf-core/fastqc")?.container;
  if (!image) throw new Error("FastQC has no pinned container in the module catalog");
  for (const dockerArgs of [[], ["-with-docker", image]]) {
    const output = await runCommand(tools.nextflow, ["run", ".", "-ansi-log", "false", ...dockerArgs], {
      cwd: helloDir, env: tools.env, logPath: join(helloDir, "console.log"), timeoutMs: 5 * 60_000,
    });
    if (!output.split("\n").includes("nextflow-studio-hello")) throw new Error("Hello workflow did not produce the expected output");
  }
  await runCommand(tools.nextflow, args, { cwd: directory, env: tools.env, logPath: join(directory, "console.log"), timeoutMs: 20 * 60_000 });
  await verifyQcExecution(directory, {
    workflowName: project.meta.workflowName, shortName: project.meta.shortName,
    counts: flags.has("--star") ? { FASTP: 2, FASTQC: 2, STAR_GENOMEGENERATE: 1, STAR_ALIGN: 2, MULTIQC: 1 } : { FASTQC: 2, MULTIQC: 1 },
  });
  console.log(`Verified real FastQC + MultiQC execution. Reports: ${join(directory, "results")}`);
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
