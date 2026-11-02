import { describe, expect, it } from "vitest";
import { createEditorStore } from "@/features/editor/store";
import { indexModules } from "./catalog";
import { scriptModuleVersions, versionDiff } from "./origin";
import type { ModuleDef, PortDef } from "./types";

const port = (name: string, kinds: ("meta" | "file" | "value")[] = ["meta", "file"]): PortDef => ({ name, description: "", elements: kinds.map((kind, i) => ({ name: `${name}${i}`, type: kind, kind, description: "" })) });
const script = (version: string, inputs: PortDef[], outputs: PortDef[]): ModuleDef => ({
  id: `script/qc/${version}`, name: "qc", version, sourceNotebookId: "nb_qc", tryRun: "passed", category: "script", description: "", keywords: [], tools: [], inputs, outputs,
} as unknown as ModuleDef);

const v1 = script("v1", [port("h5ad"), port("min_genes", ["value"])], [port("filtered"), port("report", ["file"])]);
const v2 = script("v2", [port("h5ad")], [port("filtered"), port("report", ["meta", "file"]), port("plots")]);

describe("module versions", () => {
  it("lists a notebook's versions newest first", () => {
    expect(scriptModuleVersions(v1, [v1, v2, script("v3", [], [])]).map((d) => d.version)).toEqual(["v3", "v2", "v1"]);
  });

  it("reports ports a switch removes, adds or reshapes", () => {
    expect(versionDiff(v1, v2)).toEqual({ removedInputs: ["min_genes"], removedOutputs: [], addedInputs: [], addedOutputs: ["plots"], changedPorts: ["report"] });
  });

  it("switches a node and drops links and widgets to ports the version lacks", () => {
    const store = createEditorStore();
    store.getState().setIndex(indexModules([v1, v2]));
    const node = store.getState().addNode(v1, { x: 0, y: 0 });
    const other = store.getState().addNode(v1, { x: 400, y: 0 });
    store.getState().setWidget(node.id, "min_genes", 200);
    const edges = [
      { id: "keep", source: node.id, target: other.id, sourceHandle: "filtered", targetHandle: "h5ad" },
      { id: "drop", source: other.id, target: node.id, sourceHandle: "report", targetHandle: "min_genes" },
    ];
    store.setState({ edges: edges.map((e) => ({ ...e, type: "port" })) as never });
    store.getState().switchModuleVersion(node.id, v2);
    const state = store.getState();
    expect(state.nodes.find((n) => n.id === node.id)?.data).toMatchObject({ moduleId: "script/qc/v2", widgets: {} });
    expect(state.edges.map((e) => e.id)).toEqual(["keep"]);
    state.undo();
    expect(store.getState().nodes.find((n) => n.id === node.id)?.data.moduleId).toBe("script/qc/v1");
  });
});
