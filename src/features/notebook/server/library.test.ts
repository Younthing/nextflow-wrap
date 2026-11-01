import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { readPercent } from "@/features/notebook/jupytext";
import { buildScriptModule } from "@/features/notebook/publish";
import { handleNotebookApi } from "@/features/notebook/server/http";
import type { NotebookDoc, TryRunRecord } from "@/features/notebook/types";
import { StudioStore } from "@/lib/server/database";

function post(path: string, body: unknown) {
  return new Request(`http://studio.local${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function notebook(): NotebookDoc {
  const now = "2026-11-01T00:00:00.000Z";
  return {
    id: "nb_round",
    name: "round_trip",
    description: "说明",
    kernel: "py311-pandas",
    language: "python",
    rev: 1,
    createdAt: now,
    updatedAt: now,
    cells: [
      { id: "in", role: "input", source: "# @input name=title type=str default=\"hi\"\ntitle = \"hi\"\n" },
      { id: "note", role: "markdown", source: "留在笔记本里\n" },
      { id: "ex", role: "explore", source: "print('only in the notebook')\n" },
      { id: "out", role: "output", source: "# @output name=report type=path pattern=\"report.txt\"\nopen('report.txt','w').write(title)\n" },
    ],
  };
}

function receipt(doc: NotebookDoc): TryRunRecord {
  return {
    notebookId: doc.id,
    rev: doc.rev,
    passed: true,
    exitCode: 0,
    durationMs: 4,
    log: "ok",
    outputs: [],
    ranAt: doc.updatedAt,
  };
}

describe("module library persistence", () => {
  it("stores a library artifact on publish and rebuilds a new notebook without touching the source row", async () => {
    const directory = mkdtempSync(join(tmpdir(), "studio-library-"));
    const path = join(directory, "studio.sqlite");
    try {
      const db = new StudioStore(path);
      const saved = db.saveNotebook(notebook());
      db.saveTryRun(receipt(saved));
      const sourceBeforePublish = db.notebookJson(saved.id);
      const published = await handleNotebookApi("POST", ["notebooks", saved.id, "publish"], post("/api/notebooks/nb_round/publish", {
        name: "round_trip",
        description: saved.description,
      }), db);
      expect(published.status).toBe(201);
      const view = await published.json() as { id: string; version: string; sourceNotebookId: string };
      expect(view.id).toBe("script/nb_round/v1");
      expect(view.sourceNotebookId).toBe("nb_round");
      expect(db.notebookJson(saved.id)).toBe(sourceBeforePublish);

      const library = db.libraryCopy(view.id);
      expect(library?.format).toBe("jupytext-percent");
      expect(library?.script).toBe(db.scriptModule(view.id)?.script);
      expect(library?.script).not.toContain("only in the notebook");
      expect(readPercent(library?.percent ?? "").cells).toEqual(saved.cells);

      // The same version is also a folder in the module library next to the database.
      const folder = join(directory, "library", "modules", "local", "round_trip", "v1");
      expect(readFileSync(join(folder, "notebook.py"), "utf8")).toBe(library?.percent);
      expect(readFileSync(join(folder, "main.nf"), "utf8")).toContain("process ");

      const edited = db.saveNotebook({
        ...db.notebook(saved.id)!,
        cells: [...saved.cells, { id: "later", role: "code", source: "print('later')\n" }],
      });
      expect(edited.rev).toBe(saved.rev + 1);
      const sourceAfterEdit = db.notebookJson(saved.id);

      const reopened = await handleNotebookApi("POST", ["script-modules", "reopen"], post("/api/script-modules/reopen", {
        moduleId: view.id,
      }), db);
      expect(reopened.status).toBe(201);
      const copy = await reopened.json() as NotebookDoc;
      expect(copy.id).not.toBe(saved.id);
      expect(copy.id.startsWith("nb_")).toBe(true);
      expect(copy.cells).toEqual(saved.cells);
      expect(copy.cells.map((cell) => cell.id)).not.toContain("later");
      expect(copy.libraryModuleId).toBe(view.id);
      expect(copy.librarySourceNotebookId).toBe(saved.id);
      expect(copy.rev).toBe(1);
      expect(db.notebookJson(saved.id)).toBe(sourceAfterEdit);
      expect(db.notebook(saved.id)?.cells.map((cell) => cell.id)).toContain("later");

      const changed = {
        ...copy,
        cells: copy.cells.map((cell) => (cell.id === "note" ? { ...cell, source: "改了重建本\n" } : cell)),
      };
      const put = await handleNotebookApi("PUT", ["notebooks", copy.id], new Request(`http://studio.local/api/notebooks/${copy.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(changed),
      }), db);
      expect(put.status).toBe(200);
      expect(db.notebook(copy.id)?.cells.find((cell) => cell.id === "note")?.source).toBe("改了重建本\n");
      expect(db.notebook(copy.id)?.libraryModuleId).toBe(view.id);
      expect(db.notebook(copy.id)?.librarySourceNotebookId).toBe(saved.id);
      expect(db.notebookJson(saved.id)).toBe(sourceAfterEdit);
      expect(readPercent(db.libraryCopy(view.id)?.percent ?? "").cells).toEqual(saved.cells);

      db.close();
      const again = new StudioStore(path);
      expect(again.libraryCopy(view.id)?.percent).toBe(library?.percent);
      expect(again.notebook("nb_round")?.id).toBe("nb_round");
      expect(again.notebookJson("nb_round")).toBe(sourceAfterEdit);
      again.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("backfills a library copy from the pinned revision when an older module has none", async () => {
    const directory = mkdtempSync(join(tmpdir(), "studio-library-"));
    const path = join(directory, "studio.sqlite");
    try {
      const db = new StudioStore(path);
      const saved = db.saveNotebook(notebook());
      const moduleDef = buildScriptModule({
        notebook: saved,
        name: "round_trip",
        description: saved.description,
        existing: [],
        receipt: receipt(saved),
      });
      db.saveScriptModule(moduleDef);
      expect(db.libraryCopy(moduleDef.id)).toBeUndefined();
      const edited = db.saveNotebook({
        ...saved,
        cells: [...saved.cells, { id: "drift", role: "code", source: "print('drift')\n" }],
      });
      const sourceJson = db.notebookJson(saved.id);

      const reopened = await handleNotebookApi("POST", ["script-modules", "reopen"], post("/api/script-modules/reopen", {
        moduleId: moduleDef.id,
      }), db);
      expect(reopened.status).toBe(201);
      const copy = await reopened.json() as NotebookDoc;
      expect(copy.id).not.toBe(saved.id);
      expect(copy.cells).toEqual(saved.cells);
      expect(db.libraryCopy(moduleDef.id)?.sourceNotebookRev).toBe(saved.rev);
      expect(readPercent(db.libraryCopy(moduleDef.id)?.percent ?? "").cells).toEqual(saved.cells);
      expect(db.notebook(saved.id)?.rev).toBe(edited.rev);
      expect(db.notebookJson(saved.id)).toBe(sourceJson);
      db.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
