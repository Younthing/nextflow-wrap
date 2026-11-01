import { describe, expect, it } from "vitest";

import { CATALOG_BUILTINS } from "@/features/workflow/catalog-builtins";
import { modulesForCatalog, modulesForDrawer, newerScriptModule } from "@/features/workflow/origin";
import type { ModuleDef } from "@/features/workflow/types";
import { demoNotebooks, demoScriptModules } from "./seed";
import { buildScriptModule, nextModuleVersion } from "./publish";
import type { TryRunRecord } from "./types";

const passed = (notebookId: string, rev: number): TryRunRecord => ({
  notebookId,
  rev,
  passed: true,
  exitCode: 0,
  durationMs: 10,
  log: "ok",
  outputs: [],
  ranAt: "2026-10-31T00:00:00.000Z",
});

describe("publish", () => {
  it("refuses to save without a passing try-run for the current revision", () => {
    const notebook = demoNotebooks().find((doc) => doc.id === "qc_summary")!;
    expect(() => buildScriptModule({
      notebook,
      name: "qc_summary",
      description: notebook.description,
      existing: [],
      receipt: passed(notebook.id, notebook.rev - 1),
    })).toThrow(/试跑通过/);
  });

  it("pins the current notebook revision and bumps the version", () => {
    const notebook = demoNotebooks().find((doc) => doc.id === "hello_py")!;
    const existing = demoScriptModules();
    const mod = buildScriptModule({
      notebook,
      name: "hello.py",
      description: notebook.description,
      existing,
      receipt: passed(notebook.id, notebook.rev),
    });
    expect(mod.origin).toBe("script");
    expect(mod.version).toBe(nextModuleVersion(existing, notebook.id));
    expect(mod.version).toBe("v3");
    expect(mod.sourceNotebookId).toBe(notebook.id);
    expect(mod.sourceNotebookRev).toBe(notebook.rev);
    expect(mod.tryRun).toBe("passed");
    expect(mod.inputs.some((port) => port.name === "samplesheet" && !port.widget)).toBe(true);
    expect(mod.outputs[0]?.name).toBe("hello");
    expect(mod.script).toContain("请勿手改");
    expect(mod.condaYaml).toBeUndefined();
    expect(mod.containerImage).toBeUndefined();
    expect(mod.kernel).toBe(notebook.kernel);
  });

  it("stores hand-filled conda and container without copying them from the kernel", () => {
    const notebook = demoNotebooks().find((doc) => doc.id === "qc_summary")!;
    const mod = buildScriptModule({
      notebook,
      name: "qc_summary",
      description: notebook.description,
      condaYaml: "/envs/py311-pandas.yml",
      containerImage: "ghcr.io/org/py311-pandas:1.2",
      existing: [],
      receipt: {
        ...passed(notebook.id, notebook.rev),
        condaYaml: "/envs/py311-pandas.yml",
        containerImage: "ghcr.io/org/py311-pandas:1.2",
      },
    });
    expect(mod.kernel).toBe("py311-pandas");
    expect(mod.condaYaml).toBe("/envs/py311-pandas.yml");
    expect(mod.containerImage).toBe("ghcr.io/org/py311-pandas:1.2");
    expect(mod.container).toBeUndefined();
    expect(() => buildScriptModule({
      notebook,
      name: "qc_summary",
      description: notebook.description,
      condaYaml: "/envs/py311-pandas.yml",
      containerImage: "ghcr.io/org/other:9",
      existing: [],
      receipt: {
        ...passed(notebook.id, notebook.rev),
        condaYaml: "/envs/py311-pandas.yml",
        containerImage: "ghcr.io/org/py311-pandas:1.2",
      },
    })).toThrow(/不一致/);
    expect(() => buildScriptModule({
      notebook,
      name: "qc_summary",
      description: notebook.description,
      condaYaml: "/envs/a\n.yml",
      existing: [],
      receipt: passed(notebook.id, notebook.rev),
    })).toThrow(/换行/);
  });
});

describe("module lists", () => {
  const builtins = CATALOG_BUILTINS;
  const scripts = demoScriptModules();
  const nfcore = [{ id: "nf-core/fastqc", path: "fastqc", name: "fastqc", process: "FASTQC", category: "qc", description: "", keywords: [], tools: [], inputs: [], outputs: [] }] satisfies ModuleDef[];
  const all = [...builtins, ...scripts, ...nfcore];

  it("hides failed scripts and nf-core from the drawer", () => {
    const drawer = modulesForDrawer(all, false).map((mod) => mod.id);
    expect(drawer).toContain("script/qc_summary/v1");
    expect(drawer).toContain("script/hello_py/v2");
    expect(drawer).not.toContain("script/deseq2_plot/v1");
    expect(drawer).not.toContain("nf-core/fastqc");
    expect(drawer).toContain("builtin/merge-samplesheet");
  });

  it("keeps failed scripts on the catalog and hides nf-core until asked", () => {
    const catalog = modulesForCatalog(all, false).map((mod) => mod.id);
    expect(catalog).toContain("script/deseq2_plot/v1");
    expect(catalog).not.toContain("nf-core/fastqc");
    expect(modulesForCatalog(all, true).map((mod) => mod.id)).toContain("nf-core/fastqc");
  });

  it("points a node at a newer passed publish", () => {
    const current = scripts.find((mod) => mod.id === "script/qc_summary/v1")!;
    const newer = { ...current, id: "script/qc_summary/v2", version: "v2", tryRun: "passed" as const };
    expect(newerScriptModule(current, [...scripts, newer])?.id).toBe("script/qc_summary/v2");
    expect(newerScriptModule(current, scripts)).toBeUndefined();
  });
});
