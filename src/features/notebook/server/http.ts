import { randomUUID } from "node:crypto";
import { z } from "zod";

import { ConvertError } from "@/features/notebook/convert";
import { buildScriptModule } from "@/features/notebook/publish";
import { demoNotebooks, demoRevisions, demoScriptModules } from "@/features/notebook/seed";
import { executeCells, executeTryRun } from "@/features/notebook/execute";
import { referenceCounts, scriptModuleViews, summarizeNotebook } from "@/features/notebook/library";
import { withSampleValues } from "@/features/notebook/simulate";
import { languageForKernel, type NotebookDoc } from "@/features/notebook/types";
import { HttpError } from "@/features/runs/server/service";
import type { StudioStore } from "@/lib/server/database";
import { store } from "@/lib/server/database";

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });

const cellSchema = z.object({
  id: z.string().min(1).max(80),
  role: z.enum(["code", "markdown", "input", "output", "explore"]),
  source: z.string().max(50_000),
});

const writeSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(2000).optional(),
  kernel: z.string().trim().min(1).max(80),
  cells: z.array(cellSchema).max(80),
});

const runSchema = z.object({
  cellId: z.string().min(1).max(80).optional(),
});

const trySchema = z.object({
  args: z.record(z.string().regex(/^[A-Za-z_][\w]*$/), z.string().max(4000)).optional(),
  sampleId: z.enum(["fastqc-pair", "samplesheet"]).optional(),
});

const publishSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(2000).optional(),
  changelog: z.string().max(2000).optional(),
});

export function ensureNotebookDemo(db: StudioStore = store()) {
  if (db.notebookCount() > 0) return;
  const notebooks = demoNotebooks();
  const revisions = demoRevisions(notebooks);
  const modules = demoScriptModules(notebooks);
  db.transaction(() => {
    if (db.notebookCount() > 0) return;
    for (const doc of notebooks) db.insertNotebookSnapshot(doc);
    for (const revision of revisions) db.saveRevision(revision);
    for (const mod of modules) db.saveScriptModule(mod);
  });
}

function requireNotebook(id: string): NotebookDoc {
  const doc = store().notebook(id);
  if (!doc) throw new HttpError(404, "笔记本不存在");
  return doc;
}

function allRevisions() {
  return store().notebooks().flatMap((doc) => store().revisions(doc.id));
}

export async function handleNotebookApi(method: string, path: string[], request: Request): Promise<Response> {
  ensureNotebookDemo();
  const db = store();
  const [resource, id, action, extra] = path;

  if (resource === "script-modules" && !id && method === "GET") {
    const revisions = allRevisions();
    return json({
      modules: scriptModuleViews(db.scriptModules(), db.notebooks(), revisions, db.workflows()),
      references: referenceCounts(db.workflows()),
    });
  }

  if (resource !== "notebooks") throw new HttpError(404, "接口不存在");

  if (!id && method === "GET") {
    const modules = db.scriptModules();
    return json(db.notebooks().map((doc) => summarizeNotebook(doc, modules)));
  }

  if (!id && method === "POST") {
    const body = writeSchema.parse(await request.json());
    const now = new Date().toISOString();
    const doc: NotebookDoc = {
      id: `nb_${randomUUID().slice(0, 8)}`,
      name: body.name,
      description: body.description?.trim() ?? "",
      kernel: body.kernel,
      language: languageForKernel(body.kernel),
      cells: body.cells.length ? body.cells : [{ id: "c1", role: "code", source: "" }],
      rev: 1,
      createdAt: now,
      updatedAt: now,
    };
    return json(db.saveNotebook(doc), 201);
  }

  if (!id) throw new HttpError(404, "接口不存在");
  if (!/^[\w-]{1,80}$/.test(id)) throw new HttpError(400, "无效的笔记本 id");

  if (!action && method === "GET") return json(requireNotebook(id));

  if (!action && method === "PUT") {
    const current = requireNotebook(id);
    const body = writeSchema.parse(await request.json());
    return json(db.saveNotebook({
      ...current,
      name: body.name,
      description: body.description?.trim() ?? "",
      kernel: body.kernel,
      language: languageForKernel(body.kernel),
      cells: body.cells,
    }));
  }

  if (action === "revisions" && extra && method === "GET") {
    const rev = Number(extra);
    if (!Number.isInteger(rev) || rev < 1) throw new HttpError(400, "无效的修订号");
    requireNotebook(id);
    const revision = db.revision(id, rev);
    if (!revision) throw new HttpError(404, "这个修订不存在");
    return json(revision);
  }

  if (action === "run" && method === "POST") {
    const body = runSchema.parse(await request.json().catch(() => ({})));
    try {
      return json({ cells: await executeCells(requireNotebook(id), body.cellId) });
    } catch (error) {
      if (error instanceof ConvertError) throw new HttpError(400, error.message);
      throw error;
    }
  }

  if (action === "try-run" && method === "POST") {
    const notebook = requireNotebook(id);
    const body = trySchema.parse(await request.json().catch(() => ({})));
    const values = withSampleValues(body.args ?? {}, body.sampleId);
    try {
      const record = await executeTryRun(notebook, values, body.sampleId);
      db.saveTryRun(record);
      return json(record);
    } catch (error) {
      if (error instanceof ConvertError) throw new HttpError(400, error.message);
      throw error;
    }
  }

  if (action === "publish" && method === "POST") {
    const notebook = requireNotebook(id);
    const body = publishSchema.parse(await request.json());
    let moduleDef;
    try {
      moduleDef = buildScriptModule({
        notebook,
        name: body.name,
        description: body.description ?? notebook.description,
        changelog: body.changelog,
        existing: db.scriptModules(),
        receipt: db.tryRun(notebook.id, notebook.rev),
      });
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : "无法发布");
    }
    db.saveScriptModule(moduleDef);
    const revisions = allRevisions();
    const view = scriptModuleViews([moduleDef], db.notebooks(), revisions, db.workflows())[0];
    return json(view, 201);
  }

  throw new HttpError(404, "接口不存在");
}
