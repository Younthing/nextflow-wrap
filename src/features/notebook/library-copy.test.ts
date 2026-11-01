import { describe, expect, it } from "vitest";

import { demoNotebooks, demoRevisions, demoScriptModules, demoLibraryCopies } from "./seed";
import { readPercent } from "./jupytext";
import { libraryCopyFromRevision, notebookFromLibrary } from "./library-copy";
import { publishScriptModule } from "./publish";
import type { NotebookDoc, TryRunRecord } from "./types";

const now = "2026-11-01T00:00:00.000Z";

function sample(cells = sampleCells()): NotebookDoc {
  return {
    id: "nb_round",
    name: "round_trip",
    description: "说明",
    kernel: "py311-pandas",
    language: "python",
    cells,
    rev: 3,
    createdAt: now,
    updatedAt: now,
  };
}

function sampleCells() {
  return [
    { id: "in", role: "input" as const, source: "# @input name=title type=str default=\"hi\"\ntitle = \"hi\"\n" },
    { id: "note", role: "markdown" as const, source: "留在笔记本里\n" },
    { id: "ex", role: "explore" as const, source: "print('only in the notebook')\n" },
    { id: "out", role: "output" as const, source: "# @output name=report type=path pattern=\"report.txt\"\nopen('report.txt','w').write(title)\n" },
  ];
}

function passed(
  notebook: NotebookDoc,
  env: { condaYaml?: string; containerImage?: string } = {},
): TryRunRecord {
  return {
    notebookId: notebook.id,
    rev: notebook.rev,
    passed: true,
    exitCode: 0,
    durationMs: 4,
    log: "ok",
    outputs: [],
    ranAt: now,
    ...env,
  };
}

describe("library copies", () => {
  it("pairs a jupytext notebook with the CLI and leaves the analysis notebook object alone", () => {
    const notebook = sample();
    const before = structuredClone(notebook);
    const { module: moduleDef, library } = publishScriptModule({
      notebook,
      name: "round_trip",
      description: notebook.description,
      existing: [],
      receipt: passed(notebook),
      savedAt: now,
    });
    expect(notebook).toEqual(before);
    expect(moduleDef.sourceNotebookId).toBe(notebook.id);
    expect(moduleDef.sourceNotebookRev).toBe(notebook.rev);
    expect(Object.keys(moduleDef)).not.toContain("percent");
    expect(library.moduleId).toBe(moduleDef.id);
    expect(library.version).toBe(moduleDef.version);
    expect(library.script).toBe(moduleDef.script);
    expect(library.command).toBe(moduleDef.command);
    expect(library.script).not.toContain("only in the notebook");
    expect(library.percent).toContain("only in the notebook");
    expect(readPercent(library.percent).cells).toEqual(notebook.cells);
  });

  it("keeps conda and container on the module while storing the library copy", () => {
    const notebook = sample();
    const { module: moduleDef, library } = publishScriptModule({
      notebook,
      name: "round_trip",
      description: notebook.description,
      condaYaml: "  /envs/py311-pandas.yml  ",
      containerImage: "ghcr.io/org/py311-pandas:1.2",
      existing: [],
      receipt: passed(notebook, {
        condaYaml: "/envs/py311-pandas.yml",
        containerImage: "ghcr.io/org/py311-pandas:1.2",
      }),
      savedAt: now,
    });
    expect(moduleDef.condaYaml).toBe("/envs/py311-pandas.yml");
    expect(moduleDef.containerImage).toBe("ghcr.io/org/py311-pandas:1.2");
    expect(moduleDef.kernel).toBe(notebook.kernel);
    expect(readPercent(library.percent).kernel).toBe(notebook.kernel);
    expect(readPercent(library.percent).cells).toEqual(notebook.cells);
  });

  it("rebuilds an editable notebook with a new id", () => {
    const notebook = sample();
    const { library } = publishScriptModule({
      notebook,
      name: "round_trip",
      description: notebook.description,
      existing: [],
      receipt: passed(notebook),
      savedAt: now,
    });
    const rebuilt = notebookFromLibrary(library, "nb_rebuilt", now);
    expect(rebuilt.id).not.toBe(notebook.id);
    expect(rebuilt.rev).toBe(1);
    expect(rebuilt.cells).toEqual(notebook.cells);
    expect(rebuilt.libraryModuleId).toBe(library.moduleId);
    expect(rebuilt.librarySourceNotebookId).toBe(notebook.id);
    expect(rebuilt.librarySourceNotebookRev).toBe(notebook.rev);
    rebuilt.cells = [...rebuilt.cells, { id: "extra", role: "code", source: "print(1)\n" }];
    expect(readPercent(library.percent).cells).toEqual(notebook.cells);
    expect(notebook.cells).toHaveLength(4);
  });

  it("versions library copies independently of a later notebook edit", () => {
    const first = sample();
    const v1 = publishScriptModule({
      notebook: first,
      name: "round_trip",
      description: first.description,
      existing: [],
      receipt: passed(first),
      savedAt: now,
    });
    const second: NotebookDoc = {
      ...first,
      rev: 4,
      cells: [...first.cells, { id: "later", role: "code", source: "print('later')\n" }],
    };
    const v2 = publishScriptModule({
      notebook: second,
      name: "round_trip",
      description: second.description,
      existing: [v1.module],
      receipt: passed(second),
      savedAt: now,
    });
    expect(v1.library.moduleId).not.toBe(v2.library.moduleId);
    expect(notebookFromLibrary(v1.library, "nb_a", now).cells.map((cell) => cell.id)).not.toContain("later");
    expect(notebookFromLibrary(v2.library, "nb_b", now).cells.map((cell) => cell.id)).toContain("later");
  });

  it("backfills from the pinned revision instead of a drifted notebook", () => {
    const notebooks = demoNotebooks();
    const revisions = demoRevisions(notebooks);
    const qc = notebooks.find((doc) => doc.id === "qc_summary")!;
    const pinned = revisions.find((rev) => rev.notebookId === "qc_summary" && rev.rev === 12)!;
    const moduleDef = demoScriptModules(notebooks, revisions).find((mod) => mod.id === "script/qc_summary/v1")!;
    const copy = libraryCopyFromRevision(moduleDef, qc, pinned, now);
    expect(copy?.sourceNotebookRev).toBe(12);
    expect(readPercent(copy!.percent).cells).toEqual(pinned.cells);
    expect(readPercent(copy!.percent).cells).not.toEqual(qc.cells);
    expect(demoLibraryCopies(notebooks, revisions).find((item) => item.moduleId === moduleDef.id)?.percent).toBe(copy?.percent);
    expect(libraryCopyFromRevision(moduleDef, qc, undefined)).toBeUndefined();
  });
});
