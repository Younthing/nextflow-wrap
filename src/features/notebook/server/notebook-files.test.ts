import { mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { notebookFromIpynb, serializeIpynb } from "@/features/notebook/ipynb";
import { handleNotebookApi } from "@/features/notebook/server/http";
import { NotebookConflictError, NotebookFiles } from "@/features/notebook/server/notebook-files";
import type { NotebookDoc } from "@/features/notebook/types";
import { ensureWorkspace } from "@/features/workspace/server/workspace";
import { StudioStore } from "@/lib/server/database";

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const step of cleanup.splice(0)) step();
});

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), "studio-nbfiles-"));
  const db = new StudioStore(join(directory, "studio.sqlite"));
  cleanup.push(() => {
    db.db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  await ensureWorkspace(db.workspace!);
  return { db, folder: join(db.workspace!, "notebooks"), files: new NotebookFiles(db.workspace!) };
}

function notebook(id: string, name: string, source = "print(1)\n"): NotebookDoc {
  const now = "2026-11-01T00:00:00.000Z";
  return { id, name, description: "", kernel: "py311-pandas", language: "python", rev: 1, createdAt: now, updatedAt: now, cells: [{ id: "c1", role: "code", source }] };
}

/** Bump a file's time so a rewrite within the same millisecond still counts as a change. */
function edit(path: string, change: (text: string) => string) {
  writeFileSync(path, change(readFileSync(path, "utf8")));
  const later = new Date(Date.now() + 5_000);
  utimesSync(path, later, later);
}

describe("notebook files", () => {
  it("writes a file for every notebook and names it after the notebook", async () => {
    const { db, folder, files } = await setup();
    db.saveNotebook(notebook("nb_a", "01 质控"));
    db.saveNotebook(notebook("nb_b", "01 质控"));
    await files.reconcile(db);
    expect(readdirSync(folder).sort()).toEqual(["01 质控 (nb_b).ipynb", "01 质控.ipynb"]);
    expect(notebookFromIpynb(readFileSync(join(folder, "01 质控.ipynb"), "utf8"), "x").id).toBe("nb_a");
  });

  it("imports an edit made outside the app as a new revision", async () => {
    const { db, folder, files } = await setup();
    db.saveNotebook(notebook("nb_a", "qc"));
    await files.reconcile(db);
    edit(join(folder, "qc.ipynb"), (text) => text.replace("print(1)", "print(2)"));
    await files.refresh(db, "nb_a");
    expect(db.notebook("nb_a")?.cells[0].source).toBe("print(2)\n");
    expect(db.notebook("nb_a")?.rev).toBe(2);
    expect(db.revisions("nb_a").map((revision) => revision.rev)).toEqual([1, 2]);
  });

  it("refuses a save that would overwrite an edit made on disk", async () => {
    const { db, folder, files } = await setup();
    const saved = db.saveNotebook(notebook("nb_a", "qc"));
    await files.reconcile(db);
    edit(join(folder, "qc.ipynb"), (text) => text.replace("print(1)", "print(2)"));
    await expect(files.write({ ...saved, cells: [{ id: "c1", role: "code", source: "print(3)\n" }] })).rejects.toThrow(NotebookConflictError);
    // A rewrite that only reformats the file (Jupyter adding outputs) is not a conflict.
    await files.refresh(db, "nb_a");
    edit(join(folder, "qc.ipynb"), (text) => JSON.stringify(JSON.parse(text), null, 2));
    await files.write({ ...db.notebook("nb_a")!, name: "qc" });
  });

  it("renames the file with the notebook, and the notebook with the file", async () => {
    const { db, folder, files } = await setup();
    const saved = db.saveNotebook(notebook("nb_a", "qc"));
    await files.reconcile(db);
    await files.write({ ...saved, name: "qc-v2" });
    expect(readdirSync(folder)).toEqual(["qc-v2.ipynb"]);
    renameSync(join(folder, "qc-v2.ipynb"), join(folder, "pbmc qc.ipynb"));
    await files.refresh(db, "nb_a");
    expect(db.notebook("nb_a")?.name).toBe("pbmc qc");
    expect(files.pathOf("nb_a")).toBe("notebooks/pbmc qc.ipynb");
  });

  it("adopts notebooks dropped into the folder, including copies of existing ones", async () => {
    const { db, folder, files } = await setup();
    db.saveNotebook(notebook("nb_a", "qc"));
    await files.reconcile(db);
    writeFileSync(join(folder, "qc copy.ipynb"), readFileSync(join(folder, "qc.ipynb")));
    writeFileSync(join(folder, "from-jupyter.ipynb"), JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [{ cell_type: "code", metadata: {}, source: "x = 1", outputs: [] }] }));
    writeFileSync(join(folder, "broken.ipynb"), "{");
    await files.refresh(db);
    const names = db.notebooks().map((doc) => doc.name).sort();
    expect(names).toEqual(["from-jupyter", "qc", "qc copy"]);
    const copy = db.notebooks().find((doc) => doc.name === "qc copy")!;
    expect(copy.id).not.toBe("nb_a");
    // The copy's file now records its own id.
    expect(notebookFromIpynb(readFileSync(join(folder, "qc copy.ipynb"), "utf8"), "x").id).toBe(copy.id);
  });

  it("writes a deleted file again rather than losing the notebook", async () => {
    const { db, folder, files } = await setup();
    db.saveNotebook(notebook("nb_a", "qc"));
    await files.reconcile(db);
    rmSync(join(folder, "qc.ipynb"));
    await files.refresh(db, "nb_a");
    expect(readFileSync(join(folder, "qc.ipynb"), "utf8")).toBe(serializeIpynb(db.notebook("nb_a")!));
  });

  it("serves edits from disk through the API and answers a conflicting save with 409", async () => {
    const { db, folder } = await setup();
    const request = (method: string, body?: unknown) => new Request("http://studio.local/api/notebooks", {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const created = await (await handleNotebookApi("POST", ["notebooks"], request("POST", { name: "api qc", kernel: "py311-pandas", cells: [{ id: "c1", role: "code", source: "a = 1\n" }] }), db)).json() as NotebookDoc;
    const path = join(folder, "api qc.ipynb");
    expect(notebookFromIpynb(readFileSync(path, "utf8"), "x").id).toBe(created.id);

    edit(path, (text) => text.replace("a = 1", "a = 2"));
    const read = await (await handleNotebookApi("GET", ["notebooks", created.id], request("GET"), db)).json() as NotebookDoc;
    expect(read.cells[0].source).toBe("a = 2\n");

    edit(path, (text) => text.replace("a = 2", "a = 3"));
    const conflict = handleNotebookApi("PUT", ["notebooks", created.id], request("PUT", { name: "api qc", kernel: "py311-pandas", cells: [{ id: "c1", role: "code", source: "a = 9\n" }] }), db);
    await expect(conflict).rejects.toMatchObject({ status: 409 });
    expect(db.notebook(created.id)?.cells[0].source).toBe("a = 2\n");
  });
});
