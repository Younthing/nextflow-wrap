import { describe, expect, it } from "vitest";

import { indexModules } from "@/features/workflow/catalog";
import { buildScriptModule } from "@/features/notebook/publish";
import type { NotebookDoc, TryRunRecord } from "@/features/notebook/types";
import type { WorkflowDoc } from "@/features/workflow/types";
import { moduleSlugOf, scriptEnvDirectives, scriptMetaYaml, scriptModuleFiles, scriptProcessSource } from "./script-process";
import { generateProject } from "./generate";

const notebook: NotebookDoc = {
  id: "nb_hello",
  name: "hello_note",
  description: "问候",
  kernel: "python3.11",
  language: "python",
  rev: 2,
  createdAt: "2026-10-31T00:00:00.000Z",
  updatedAt: "2026-10-31T00:00:00.000Z",
  cells: [
    {
      id: "c1",
      role: "input",
      source: '# @input name=title type=str default="hi"\n',
    },
    {
      id: "c2",
      role: "output",
      source: '# @output name=report type=path pattern="report.html"\nopen("report.html", "w", encoding="utf-8").write(title)\n',
    },
  ],
};

const receipt: TryRunRecord = {
  notebookId: notebook.id,
  rev: notebook.rev,
  passed: true,
  exitCode: 0,
  durationMs: 5,
  log: "ok",
  outputs: [{ name: "report", file: "report.html", bytes: 2, ok: true }],
  ranAt: notebook.updatedAt,
};

describe("script module project files", () => {
  it("emits a hidden local process next to its script", () => {
    const def = buildScriptModule({
      notebook,
      name: "hello_note",
      description: notebook.description,
      existing: [],
      receipt,
    });
    const doc: WorkflowDoc = {
      id: "wf_script",
      name: "script flow",
      version: 1,
      params: { input: "assets/samplesheet.csv", outdir: "results" },
      nodes: [
        { id: "input", position: { x: 0, y: 0 }, data: { moduleId: "builtin/samplesheet", alias: "SAMPLESHEET", widgets: {}, config: {} } },
        { id: "hello", position: { x: 240, y: 0 }, data: { moduleId: def.id, alias: "HELLO_NOTE", widgets: { title: "hi" }, config: { publish: true } } },
      ],
      edges: [],
      updatedAt: notebook.updatedAt,
    };
    const project = generateProject(doc, indexModules([def]), {});
    const workflow = project.files.find((file) => file.path === "main.nf")!.content;
    const process = project.files.find((file) => file.path === `modules/local/${def.path}/main.nf`)!.content;
    const script = project.files.find((file) => file.path === `modules/local/${def.path}/resources/usr/bin/hello_note_v1.py`)!.content;
    expect(workflow).toContain(`from './modules/local/${def.path}/main'`);
    expect(workflow).toContain("HELLO_NOTE (");
    expect(process).toContain("process HELLO_NOTE");
    expect(process).not.toContain("notebook");
    expect(script).toContain("argparse");
    // Found on PATH, so the same main.nf works from resources/usr/bin and from the project's bin/.
    expect(process).toContain('python3 "\\$(command -v hello_note_v1.py)"');
    // ext.args continues the CLI's command line rather than running as its own command.
    expect(process).toMatch(/--title '\$\{title\}' \\\\\n\s+\$\{task\.ext\.args \?: ''\}\n/);
    expect(process).not.toContain("conda ");
    expect(process).not.toContain("container ");
  });

  it("writes conda and container directives from the module env fields", () => {
    const def = buildScriptModule({
      notebook,
      name: "hello_note",
      description: notebook.description,
      condaYaml: "  /envs/py311-pandas.yml  ",
      containerImage: "ghcr.io/org/py311-pandas:1.2",
      existing: [],
      receipt: {
        ...receipt,
        condaYaml: "/envs/py311-pandas.yml",
        containerImage: "ghcr.io/org/py311-pandas:1.2",
      },
    });
    expect(def.kernel).toBe("python3.11");
    expect(def.condaYaml).toBe("/envs/py311-pandas.yml");
    expect(def.containerImage).toBe("ghcr.io/org/py311-pandas:1.2");
    const source = scriptProcessSource(def);
    expect(source).toContain("process HELLO_NOTE {");
    expect(source).toContain("    conda '/envs/py311-pandas.yml'\n    container 'ghcr.io/org/py311-pandas:1.2'\n    input:");
    const project = generateProject({
      id: "wf_env",
      name: "env flow",
      version: 1,
      params: { input: "assets/samplesheet.csv", outdir: "results" },
      nodes: [
        { id: "input", position: { x: 0, y: 0 }, data: { moduleId: "builtin/samplesheet", alias: "SAMPLESHEET", widgets: {}, config: {} } },
        { id: "hello", position: { x: 240, y: 0 }, data: { moduleId: def.id, alias: "HELLO_NOTE", widgets: { title: "hi" }, config: {} } },
      ],
      edges: [],
      updatedAt: notebook.updatedAt,
    }, indexModules([def]), {});
    const process = project.files.find((file) => file.path === `modules/local/${def.path}/main.nf`)!.content;
    expect(process).toContain("conda '/envs/py311-pandas.yml'");
    expect(process).toContain("container 'ghcr.io/org/py311-pandas:1.2'");
  });

  it("emits only the env directive that was filled and escapes quotes", () => {
    const condaOnly = scriptProcessSource({
      id: "script/nb/v1",
      path: "nb_v1",
      name: "nb",
      process: "NB",
      category: "自定义",
      description: "",
      keywords: [],
      tools: [],
      inputs: [],
      outputs: [],
      condaYaml: "/envs/o'brien.yml",
    });
    expect(condaOnly).toContain("conda '/envs/o\\'brien.yml'");
    expect(condaOnly).not.toContain("container ");
    expect(scriptEnvDirectives({ containerImage: "img:1" })).toEqual(["container 'img:1'"]);
    expect(scriptEnvDirectives({})).toEqual([]);
  });

  it("lays out a self-contained module directory with its metadata and environment", () => {
    const def = {
      ...buildScriptModule({ notebook, name: "hello_note", description: notebook.description, existing: [], receipt }),
      condaYaml: "/envs/hello.yml",
      environmentYml: "channels: [conda-forge]\ndependencies: [python=3.11]",
    };
    expect(moduleSlugOf(def)).toBe("hello_note");
    const files = scriptModuleFiles(def);
    expect(files.map((file) => file.path)).toEqual(["main.nf", "meta.yml", "environment.yml", "resources/usr/bin/hello_note_v1.py"]);
    expect(files.find((file) => file.path.startsWith("resources/"))!.executable).toBe(true);
    // A module carrying its own environment points at it rather than the original path.
    expect(files[0].content).toContain('conda "${moduleDir}/environment.yml"');
    expect(files[0].content).not.toContain("/envs/hello.yml");
    const meta = scriptMetaYaml(def);
    expect(meta).toContain('name: "hello_note"');
    expect(meta).toContain('namespace: "local"');
    expect(meta).toContain('version: "v1"');
    expect(meta).toContain("  - name: title\n    type: val");
    expect(meta).toContain('    pattern: "report.html"');
    expect(meta).toContain('  notebook: "nb_hello"');
  });
});
