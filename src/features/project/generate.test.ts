import { describe, expect, it } from "vitest";

import catalog from "@/data/nf-core-modules.json";
import { indexModules } from "@/features/workflow/catalog";
import { demoRnaseqWorkflow } from "@/features/workflow/demo";
import type { ModuleCatalog, WorkflowDoc } from "@/features/workflow/types";
import { GenerateError, generateProject } from "./generate";

const typed = catalog as ModuleCatalog;
const index = indexModules(typed.modules);
const generate = (doc: WorkflowDoc) => generateProject(doc, index, { modulesSha: typed.gitSha });
const file = (doc: WorkflowDoc, path: string) => generate(doc).files.find((f) => f.path === path)!.content;

describe("generateProject", () => {
  const demo = demoRnaseqWorkflow("wf");

  it("lays out an nf-core style project", () => {
    const paths = generate(demo).files.map((f) => f.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "main.nf",
        "workflows/rnaseq.nf",
        "subworkflows/local/utils_nfcore_rnaseq_pipeline/main.nf",
        "nextflow.config",
        "conf/base.config",
        "conf/modules.config",
        "nextflow_schema.json",
        "assets/schema_input.json",
        "modules.json",
      ]),
    );
  });

  it("wires channels with the right adapters", () => {
    const wf = file(demo, "workflows/rnaseq.nf");
    expect(wf).toContain("include { FASTP");
    expect(wf).toContain("} from '../modules/nf-core/star/align/main'");
    // samplesheet [meta, reads] into fastp [meta, reads, adapter_fasta]
    expect(wf).toContain("ch_samplesheet.map { tuple -> tuple + [ [] ] }");
    // reference params become value channels
    expect(wf).toContain("def ch_gtf_meta = channel.value([ [ id: file(params.gtf).baseName ], file(params.gtf, checkIfExists: true) ])");
    // a one-off index feeding a per-sample process becomes a value channel
    expect(wf).toContain("STAR_GENOMEGENERATE.out.index.first()");
    // widgets are passed as literals
    expect(wf).toContain("false // star_ignore_sjdbgtf");
    expect(wf).toContain("false, // discard_trimmed_pass");
    // MultiQC gathers every linked report
    expect(wf).toContain("FASTQC.out.zip.map { tuple -> tuple[1..-1] }");
    expect(wf).toContain("MULTIQC.out.report.map { _meta, report -> [report] }.toList()");
    // Groovy interpolation survives templating
    expect(wf).toContain('"${outdir}/pipeline_info"');
    expect(wf).not.toContain("@{");
  });

  it("orders module calls after their inputs", () => {
    const wf = file(demo, "workflows/rnaseq.nf");
    expect(wf.indexOf("STAR_GENOMEGENERATE (")).toBeLessThan(wf.indexOf("STAR_ALIGN ("));
    expect(wf.indexOf("FASTP (")).toBeLessThan(wf.indexOf("FASTQC ("));
  });

  it("writes per-node module options", () => {
    const cfg = file(demo, "conf/modules.config");
    expect(cfg).toContain("withName: 'STAR_ALIGN' {");
    expect(cfg).toContain("ext.args   = '--outSAMtype BAM SortedByCoordinate --quantMode GeneCounts'");
    expect(cfg).toContain('path: { "${params.outdir}/star_align" }');
  });

  it("declares every schema param in nextflow.config", () => {
    const project = generate(demo);
    const schema = JSON.parse(project.files.find((f) => f.path === "nextflow_schema.json")!.content);
    const config = project.files.find((f) => f.path === "nextflow.config")!.content;
    for (const group of Object.values<{ properties: Record<string, unknown> }>(schema.$defs)) {
      for (const key of Object.keys(group.properties)) {
        expect(config).toMatch(new RegExp(`^\\s+${key}\\s+=`, "m"));
      }
    }
    expect(schema.$defs.reference_files.properties.fasta.format).toBe("file-path");
  });

  it("pins modules.json to the catalog commit", () => {
    const modulesJson = JSON.parse(file(demo, "modules.json"));
    const modules = modulesJson.repos["https://github.com/nf-core/modules.git"].modules["nf-core"];
    expect(Object.keys(modules).sort()).toEqual(["fastp", "fastqc", "multiqc", "star/align", "star/genomegenerate"]);
    expect(modules.fastp.git_sha).toBe(typed.gitSha);
  });

  it("skips disabled nodes and rejects a missing main input", () => {
    const disabled = {
      ...demo,
      nodes: demo.nodes.map((n) => (n.id === "fastqc" ? { ...n, data: { ...n.data, disabled: true } } : n)),
    };
    expect(file(disabled, "workflows/rnaseq.nf")).not.toContain("FASTQC (");

    const unlinked = { ...demo, edges: demo.edges.filter((e) => e.target !== "fastqc") };
    expect(() => generate(unlinked)).toThrow(GenerateError);
  });

  it("rejects cycles", () => {
    const cyclic = {
      ...demo,
      edges: [
        ...demo.edges,
        { id: "loop", source: "fastqc", sourceHandle: "out:zip", target: "fastp", targetHandle: "in:reads" },
      ],
    };
    expect(() => generate(cyclic)).toThrow(/循环/);
  });
});

describe("groovy literals", () => {
  it("keeps multi-line ext.args on one line", async () => {
    const { gdynamic } = await import("./groovy");
    expect(gdynamic("--a 1\n  --b 2\n")).toBe("'--a 1 --b 2'");
    expect(gdynamic("--sample ${meta.id}\n--x")).toBe('{ "--sample ${meta.id} --x" }');
  });
});
