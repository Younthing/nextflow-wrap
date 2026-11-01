import { describe, expect, it } from "vitest";

import { demoScriptModules } from "@/features/notebook/seed";
import { REFERENCE_ID } from "@/features/workflow/builtins";
import { indexModules } from "@/features/workflow/catalog";
import { demoWorkflow, readsQcWorkflow } from "@/features/workflow/demo";
import { EXAMPLE_MODULES } from "@/features/workflow/example-modules";
import type { WorkflowDoc } from "@/features/workflow/types";
import { GenerateError, generateProject, projectMeta } from "./generate";

const index = indexModules(EXAMPLE_MODULES);
const generate = (doc: WorkflowDoc) => generateProject(doc, index);
const file = (doc: WorkflowDoc, path: string) => generate(doc).files.find((f) => f.path === path)!.content;

describe("generateProject", () => {
  const demo = demoWorkflow("wf");
  const reads = readsQcWorkflow("qc");

  it("lays out a plain Nextflow project without nf-core pieces", () => {
    const paths = generate(demo).files.map((f) => f.path);
    expect(paths).toEqual(["main.nf", "nextflow.config", "conf/base.config", "conf/modules.config", "nextflow_schema.json", "README.md"]);
    const config = file(demo, "nextflow.config");
    expect(config).not.toMatch(/plugins|nf-schema|nf-core|validation/);
    expect(config).toContain("profiles {");
  });

  it("adds the samplesheet schema and example only when the canvas reads one", () => {
    const paths = generate(reads).files.map((f) => f.path);
    expect(paths).toContain("assets/schema_input.json");
    expect(paths).toContain("assets/samplesheet.csv");
    const main = file(reads, "main.nf");
    expect(main).toContain("channel.fromPath(params.input, checkIfExists: true)");
    expect(main).toContain(".splitCsv(header: true, strip: true)");
    expect(file(demo, "main.nf")).not.toContain("params.input");
  });

  it("includes every module from modules/local", () => {
    const main = file(demo, "main.nf");
    expect(main).toMatch(/include \{ SCANPY_QC\s+\} from '.\/modules\/local\/scanpy_qc\/main'/);
    expect(main).toMatch(/include \{ SUMMARY_REPORT\s+\} from '.\/modules\/local\/summary_report\/main'/);
    expect(main).not.toContain("nf-core");
  });

  it("wires channels with the right adapters", () => {
    const main = file(reads, "main.nf");
    // samplesheet [meta, reads] into [meta, reads, adapters]
    expect(main).toContain("ch_samplesheet.map { tuple -> tuple + [ [] ] }");
    // widgets are passed as literals
    expect(main).toContain("30 // min_length");
    // the collecting report gathers every linked output
    expect(main).toContain("FASTQ_QC.out.html.map { tuple -> tuple[1..-1] }");
    expect(main).toContain(".map { files -> [ [ id: 'summary_report' ], files ] }");
    // reference params become value channels
    expect(file(demo, "main.nf")).toContain(
      "def ch_counts_meta = channel.value([ [ id: file(params.counts).baseName ], file(params.counts, checkIfExists: true) ])",
    );
    expect(main).not.toContain("@{");
  });

  it("orders module calls after their inputs", () => {
    const main = file(reads, "main.nf");
    expect(main.indexOf("TRIM_READS (")).toBeLessThan(main.indexOf("FASTQ_QC ("));
    expect(main.indexOf("FASTQ_QC (")).toBeLessThan(main.indexOf("SUMMARY_REPORT ("));
  });

  it("writes per-node module options", () => {
    const doc = {
      ...demo,
      nodes: demo.nodes.map((n) => (n.id === "cluster" ? { ...n, data: { ...n.data, config: { publish: true, args: "--n-pcs 30" } } } : n)),
    };
    const cfg = file(doc, "conf/modules.config");
    expect(cfg).toContain("withName: 'SCANPY_CLUSTER' {");
    expect(cfg).toContain("ext.args   = '--n-pcs 30'");
    expect(cfg).toContain('path: { "${params.outdir}/scanpy_cluster" }');
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
    expect(schema.$defs.reference_files.properties.counts.format).toBe("file-path");
    expect(schema.$defs.input_output_options.required).toEqual(["outdir"]);
  });

  it("writes published notebook modules and their scripts", () => {
    const hello = demoScriptModules().find((def) => def.id === "script/hello_py/v2")!;
    const doc: WorkflowDoc = {
      ...demo,
      params: { sheet: "sheet.csv", outdir: "results" },
      nodes: [
        { id: "sheet", position: { x: 0, y: 0 }, data: { moduleId: REFERENCE_ID, alias: "SHEET", widgets: {}, config: {}, settings: { param: "sheet", format: "other" } } },
        { id: "hello", position: { x: 0, y: 0 }, data: { moduleId: hello.id, alias: "HELLO", widgets: {}, config: {} } },
      ],
      edges: [{ id: "e", source: "sheet", sourceHandle: "out:file", target: "hello", targetHandle: "in:samplesheet" }],
    };
    const project = generateProject(doc, indexModules([hello]));
    const paths = project.files.map((f) => f.path);
    expect(paths).toContain(`modules/local/${hello.path}/main.nf`);
    expect(paths).toContain(`modules/local/${hello.path}/meta.yml`);
    const cli = project.files.find((f) => f.path === `modules/local/${hello.path}/resources/usr/bin/hello_py_v2.py`)!;
    expect(cli.executable).toBe(true);
    expect(project.files.find((f) => f.path === "nextflow.config")!.content).toContain("nextflow.enable.moduleBinaries = true");

    const remote = generateProject(doc, indexModules([hello]), { scriptLayout: "bin" });
    expect(remote.files.map((f) => f.path)).toContain(hello.command);
    expect(remote.files.find((f) => f.path === "nextflow.config")!.content).not.toContain("moduleBinaries");
  });

  it("skips disabled nodes and rejects a missing main input", () => {
    const disabled = {
      ...reads,
      nodes: reads.nodes.map((n) => (n.id === "qc" ? { ...n, data: { ...n.data, disabled: true } } : n)),
    };
    expect(file(disabled, "main.nf")).not.toContain("FASTQ_QC (");

    const unlinked = { ...reads, edges: reads.edges.filter((e) => e.target !== "qc") };
    expect(() => generate(unlinked)).toThrow(GenerateError);
  });

  it("rejects cycles", () => {
    const cyclic = {
      ...reads,
      edges: [...reads.edges, { id: "loop", source: "qc", sourceHandle: "out:html", target: "trim", targetHandle: "in:reads" }],
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

describe("project naming", () => {
  it("keeps workflow identifiers starting with a letter", () => {
    const meta = projectMeta({ name: "x", project: { name: "studio/10xrnaseq", version: "1.0", author: "a" } });
    expect(meta.workflowName).toBe("NF10XRNASEQ");
  });
});
