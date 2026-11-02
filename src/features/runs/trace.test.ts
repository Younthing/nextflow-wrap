import { describe, expect, it } from "vitest";
import { indexModules } from "@/features/workflow/catalog";
import type { ModuleDef, WorkflowDoc } from "@/features/workflow/types";
import type { TaskRecord } from "./types";
import { notebookSnippet, traceResult } from "./trace";

const workflow = { nodes: [{ id: "n1", position: { x: 0, y: 0 }, data: { moduleId: "script/cluster/v2", alias: "CLUSTER", widgets: {}, config: {} } }] } as unknown as WorkflowDoc;
const mod = { id: "script/cluster/v2", name: "cluster", version: "v2", sourceNotebookId: "nb_cluster", sourceNotebookRev: 7 } as unknown as ModuleDef;
const task = (tag: string): TaskRecord => ({ hash: `aa/${tag}`, nodeId: "n1", process: "MAIN:CLUSTER", name: `CLUSTER (${tag})`, tag, status: "completed", cpus: 1, workdir: "/w" });

describe("traceResult", () => {
  it("follows a result to its node, module version, notebook revision and task", () => {
    const source = traceResult({ path: "cluster/PBMC_2.h5ad", nodeId: "n1" }, workflow, indexModules([mod]), [task("PBMC_1"), task("PBMC_2")]);
    expect(source).toMatchObject({ alias: "CLUSTER", version: "v2", notebook: { id: "nb_cluster", rev: 7 } });
    expect(source?.tasks.map((t) => t.tag)).toEqual(["PBMC_2"]);
  });

  it("falls back to the folder name and to every task of the node", () => {
    const source = traceResult({ path: "cluster/markers.csv" }, workflow, undefined, [task("PBMC_1"), task("PBMC_2")]);
    expect(source?.nodeId).toBe("n1");
    expect(source?.tasks).toHaveLength(2);
    expect(traceResult({ path: "pipeline_info/trace.tsv" }, workflow, undefined, [])).toBeUndefined();
  });
});

describe("notebookSnippet", () => {
  it("loads common downstream formats", () => {
    expect(notebookSnippet("/r/a.h5ad")).toContain('sc.read_h5ad("/r/a.h5ad")');
    expect(notebookSnippet("/r/a.tsv")).toContain('sep="\\t"');
    expect(notebookSnippet("/r/pose.pdbqt")).toContain("read_text");
  });
});
