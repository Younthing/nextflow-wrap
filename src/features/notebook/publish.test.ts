import { describe, expect, it } from "vitest";

import { CATALOG_BUILTINS } from "@/features/workflow/catalog-builtins";
import { modulesForCatalog, modulesForDrawer } from "@/features/workflow/origin";
import { demoNotebooks, demoScriptModules } from "./seed";
import { buildScriptModule } from "./publish";
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

  it("overwrites a chosen module in place: same id, next version, no link to the notebook", () => {
    const notebook = demoNotebooks().find((doc) => doc.id === "hello_py")!;
    const existing = demoScriptModules();
    const mod = buildScriptModule({
      notebook,
      name: "hello.py",
      description: notebook.description,
      existing,
      overwrite: "script/hello_py",
      receipt: passed(notebook.id, notebook.rev),
    });
    expect(mod.origin).toBe("script");
    expect(mod.id).toBe("script/hello_py");
    expect(mod.version).toBe("v3");
    expect(JSON.stringify(mod)).not.toContain("sourceNotebook");
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

describe("export target", () => {
  const notebook = demoNotebooks().find((doc) => doc.id === "hello_py")!;
  const build = (name: string, overwrite?: string) => buildScriptModule({ notebook, name, description: "", existing: demoScriptModules(), overwrite, receipt: passed(notebook.id, notebook.rev) });

  it("makes a new module from an unused name", () => {
    const mod = build("hello_again");
    expect([mod.id, mod.version]).toEqual(["script/hello_again", "v1"]);
  });
  it("refuses a name another module has, and an unknown module to overwrite", () => {
    expect(() => build("hello_py")).toThrow(/选择覆盖它或换个名字/);
    expect(() => build("x", "script/missing")).toThrow(/不存在/);
  });
});

describe("module lists", () => {
  const builtins = CATALOG_BUILTINS;
  const scripts = demoScriptModules();
  const all = [...builtins, ...scripts];

  it("hides failed scripts from the drawer", () => {
    const drawer = modulesForDrawer(all).map((mod) => mod.id);
    expect(drawer).toContain("script/qc_summary");
    expect(drawer).toContain("script/hello_py");
    expect(drawer).not.toContain("script/deseq2_plot");
    expect(drawer).toContain("builtin/merge-samplesheet");
  });

  it("keeps failed scripts on the catalog", () => {
    const catalog = modulesForCatalog(all).map((mod) => mod.id);
    expect(catalog).toContain("script/deseq2_plot");
    expect(catalog).toContain("builtin/merge-samplesheet");
  });
});
