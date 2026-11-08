import { describe, expect, it } from "vitest";

import { indexModules } from "@/features/workflow/catalog";
import { validateWorkflow } from "@/features/workflow/validate";
import { exampleModules } from "./examples";
import { IF_EXAMPLE_KEYWORDS, ifExampleNotebooks, ifExampleWorkflow } from "./examples-if";
import { IF_SIDE_MODULE_IDS, ifSideNotebooks, ifSideWorkflow } from "./examples-if-side";

describe("immunofluorescence example workflows", () => {
  const modules = exampleModules([...ifExampleNotebooks(), ...ifSideNotebooks()], IF_EXAMPLE_KEYWORDS);
  const catalog = indexModules(modules);

  it("keeps the main chain at five modules and wires the main chain plus every side branch into the full workflow", () => {
    for (const doc of [ifExampleWorkflow(), ifSideWorkflow()]) {
      expect(validateWorkflow(doc.nodes, doc.edges, doc.params, catalog).filter((issue) => issue.level === "error")).toEqual([]);
    }
    expect(ifExampleWorkflow().nodes.filter((item) => item.data.moduleId.startsWith("modules/")).length).toBe(5);
    const used = new Set(ifSideWorkflow().nodes.map((item) => item.data.moduleId));
    const main = ifExampleWorkflow().nodes.map((item) => item.data.moduleId).filter((id) => id.startsWith("modules/"));
    expect([...main, ...IF_SIDE_MODULE_IDS].every((id) => used.has(id))).toBe(true);
  });

  it("never declares an input name Nextflow reserves (IF_BLOB_DETECT used `channel`)", () => {
    const blob = modules.find((def) => def.id === "modules/if_blob_detect/v1/module.json")!;
    expect(blob.inputs.map((port) => port.name)).toContain("channel_index");
    for (const def of modules) {
      expect(def.inputs.map((port) => port.name)).not.toContain("channel");
      expect(def.script).not.toMatch(/--channel\b(?!_)/);
    }
  });

  it("needs apoc only in the APOC module and never opens a napari viewer", () => {
    for (const def of modules) {
      expect(def.script).not.toMatch(/napari/);
      if (def.id === "modules/if_pixel_clf_apoc/v1/module.json") expect(def.script).toMatch(/import apoc/);
      else expect(def.script).not.toMatch(/apoc|pyclesperanto/);
    }
  });
});
