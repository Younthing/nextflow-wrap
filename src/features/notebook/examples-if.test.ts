import { describe, expect, it } from "vitest";

import { indexModules } from "@/features/workflow/catalog";
import { validateWorkflow } from "@/features/workflow/validate";
import { exampleModules } from "./examples";
import { IF_EXAMPLE_KEYWORDS, ifExampleNotebooks, ifExampleWorkflow } from "./examples-if";
import { IF_SIDE_MODULE_IDS, ifSideNotebooks, ifSideWorkflow } from "./examples-if-side";

describe("immunofluorescence example workflows", () => {
  const modules = exampleModules([...ifExampleNotebooks(), ...ifSideNotebooks()], IF_EXAMPLE_KEYWORDS);
  const catalog = indexModules(modules);

  it("keeps the main chain at five modules and wires every side branch into a valid workflow", () => {
    for (const doc of [ifExampleWorkflow(), ifSideWorkflow()]) {
      expect(validateWorkflow(doc.nodes, doc.edges, doc.params, catalog).filter((issue) => issue.level === "error")).toEqual([]);
    }
    expect(ifExampleWorkflow().nodes.filter((item) => item.data.moduleId.startsWith("script/")).length).toBe(5);
    const used = new Set(ifSideWorkflow().nodes.map((item) => item.data.moduleId));
    expect(IF_SIDE_MODULE_IDS.every((id) => used.has(id))).toBe(true);
  });

  it("needs apoc only in the APOC module and never opens a napari viewer", () => {
    for (const def of modules) {
      expect(def.script).not.toMatch(/napari/);
      if (def.id === "script/if_pixel_clf_apoc") expect(def.script).toMatch(/import apoc/);
      else expect(def.script).not.toMatch(/apoc|pyclesperanto/);
    }
  });
});
