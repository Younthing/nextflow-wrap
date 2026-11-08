import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { handleNotebookApi } from "./http";
import { StudioStore } from "@/lib/server/database";
import type { NotebookDoc } from "../types";

const cleanup: (() => void)[] = [];
afterEach(() => { for (const step of cleanup.splice(0)) step(); });
function setup(handle = "project") {
  const root = mkdtempSync(join(tmpdir(), "studio-docs-"));
  const db = new StudioStore(join(root, ".studio", "state.sqlite"), root, handle);
  cleanup.push(() => { db.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, db };
}
const request = (method: string, body?: unknown) => new Request("http://studio.local/api/notebooks", { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
async function create(db: StudioStore, path = "analysis/day1.ipynb") {
  return (await (await handleNotebookApi("POST", ["notebooks"], request("POST", { name: "day1", kernel: "python3", cells: [{ id: "c1", role: "code", source: "a = 1" }], filePath: path }), db)).json()) as NotebookDoc;
}

describe("project notebook documents", () => {
  it("creates a real notebook in any selected subdirectory and reopens it without a database index", async () => {
    const { root, db } = setup();
    const doc = await create(db);
    expect(JSON.parse(readFileSync(join(root, doc.filePath!), "utf8")).nbformat).toBe(4);
    const independent = new StudioStore(":memory:", root, "another-window");
    try { expect(independent.notebook(doc.id)?.cells[0].source).toBe("a = 1"); } finally { independent.close(); }
  });
  it("reads external edits and rejects a stale save without changing the disk", async () => {
    const { root, db } = setup();
    const doc = await create(db);
    const path = join(root, doc.filePath!);
    writeFileSync(path, readFileSync(path, "utf8").replace("a = 1", "a = 2"));
    expect(db.notebook(doc.id)?.cells[0].source).toBe("a = 2");
    await expect(handleNotebookApi("PUT", ["notebooks", doc.id], request("PUT", doc), db)).rejects.toMatchObject({ status: 409 });
    expect(db.notebook(doc.id)?.cells[0].source).toBe("a = 2");
  });
  it("retains identity across folder moves and never recreates an externally deleted notebook", async () => {
    const { root, db } = setup();
    const doc = await create(db);
    mkdirSync(join(root, "other"));
    renameSync(join(root, doc.filePath!), join(root, "other/moved.ipynb"));
    const moved = db.notebook(doc.id)!;
    expect(moved.filePath).toBe("other/moved.ipynb");
    rmSync(join(root, moved.filePath!));
    expect(db.notebook(doc.id)).toBeUndefined();
    expect(() => db.saveNotebook(moved)).toThrow();
    expect(db.notebook(doc.id)).toBeUndefined();
  });
  it("keeps equal document IDs in different projects isolated", async () => {
    const a = setup("a"); const b = setup("b");
    const doc = await create(a.db);
    b.db.saveNotebook({ ...doc, projectId: "b", fileVersion: undefined, cells: [{ id: "c1", role: "code", source: "other" }] });
    expect(a.db.notebook(doc.id)?.cells[0].source).toBe("a = 1");
    expect(b.db.notebook(doc.id)?.cells[0].source).toBe("other");
  });
  it("adopts Jupyter metadata and distinguishes a copied notebook", async () => {
    const { root, db } = setup();
    const doc = await create(db);
    const path = join(root, doc.filePath!);
    const raw = JSON.parse(readFileSync(path, "utf8"));
    raw.metadata.custom = { lab: "mine" }; raw.cells[0].metadata.tags = ["retain"];
    writeFileSync(path, JSON.stringify(raw));
    const external = db.notebook(doc.id)!;
    const saved = db.saveNotebook({ ...external, description: "updated" });
    const after = JSON.parse(readFileSync(path, "utf8"));
    expect(after.metadata.custom).toEqual({ lab: "mine" });
    expect(after.cells[0].metadata.tags).toEqual(["retain"]);
    writeFileSync(join(root, "copy.ipynb"), readFileSync(path));
    const docs = db.notebooks();
    expect(new Set(docs.map((item) => item.id)).size).toBe(2);
    expect(db.revision(doc.id, saved.rev)?.cells[0].source).toBe("a = 1");
  });
});
