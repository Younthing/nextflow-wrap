import { randomUUID } from "node:crypto";
import { z } from "zod";

import { ConvertError } from "@/features/notebook/convert";
import { EnvFieldError, patchModuleEnv } from "@/features/notebook/env";
import { PercentError } from "@/features/notebook/jupytext";
import { notebookFromLibrary, storedLibraryCopy, type ModuleLibraryCopy } from "@/features/notebook/library-copy";
import { publishScriptModule } from "@/features/notebook/publish";
import { demoLibraryCopies, demoNotebooks, demoRevisions, demoScriptModules } from "@/features/notebook/seed";
import { executeTryRun, runNotebookCells } from "@/features/notebook/execute";
import { NotebookConflictError, notebookFiles } from "@/features/notebook/server/notebook-files";
import { ensureModuleLibrary, ModuleLibraryError, readEnvironmentYml, writeLibraryModule } from "@/features/notebook/server/module-library";
import { existingKernel, kernelFor, kernelInfo, KernelUnavailableError, listKernelSpecs, shutdownKernel } from "@/features/notebook/server/kernels";
import { referenceCounts, scriptModuleViews, summarizeNotebook } from "@/features/notebook/library";
import { languageForKernel, type NotebookDoc } from "@/features/notebook/types";
import { HttpError } from "@/features/runs/server/service";
import type { ModuleDef } from "@/features/workflow/types";
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
  kernel: z.string().trim().min(1).max(80).refine((value) => !/[\u0000-\u001f]/.test(value), "内核名称不能包含换行"),
  cells: z.array(cellSchema).max(80),
});

const runSchema = z.object({
  cellId: z.string().min(1).max(80).optional(),
});

const kernelActionSchema = z.object({
  action: z.enum(["interrupt", "restart", "shutdown"]),
});

const envField = z.string().max(500);

const bindingFileSchema = z.object({
  name: z.string().min(1).max(200),
  contentBase64: z.string().max(1_400_000),
});

const bindingSchema = z.object({
  port: z.string().regex(/^[A-Za-z_][\w]*$/),
  source: z.enum(["upload", "path", "sample"]),
  value: z.string().max(4000).optional(),
  files: z.array(bindingFileSchema).max(8).optional(),
});

const trySchema = z.object({
  bindings: z.array(bindingSchema).max(40).optional(),
  condaYaml: envField.optional(),
  containerImage: envField.optional(),
});

const publishSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(2000).optional(),
  changelog: z.string().max(2000).optional(),
  condaYaml: envField.optional(),
  containerImage: envField.optional(),
});

const envSchema = z.object({
  condaYaml: envField.optional(),
  containerImage: envField.optional(),
});

const reopenSchema = z.object({
  moduleId: z.string().trim().min(1).max(200).regex(/^[\w./-]+$/),
});

export function ensureNotebookDemo(db: StudioStore = store()) {
  if (db.notebookCount() > 0) return;
  const notebooks = demoNotebooks();
  const revisions = demoRevisions(notebooks);
  const modules = demoScriptModules(notebooks, revisions);
  const libraries = demoLibraryCopies(notebooks, revisions, modules);
  db.transaction(() => {
    if (db.notebookCount() > 0) return;
    for (const doc of notebooks) db.insertNotebookSnapshot(doc);
    for (const revision of revisions) db.saveRevision(revision);
    for (const mod of modules) db.saveScriptModule(mod);
    for (const copy of libraries) db.saveLibraryCopy(copy);
  });
}

function requireNotebook(db: StudioStore, id: string): NotebookDoc {
  const doc = db.notebook(id);
  if (!doc) throw new HttpError(404, "笔记本不存在");
  return doc;
}

function allRevisions(db: StudioStore) {
  return db.notebooks().flatMap((doc) => db.revisions(doc.id));
}

function newNotebookId(db: StudioStore): string {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = `nb_${randomUUID().slice(0, 8)}`;
    if (!db.notebook(id)) return id;
  }
  throw new HttpError(500, "无法分配笔记本 id");
}

function libraryForModule(db: StudioStore, moduleId: string) {
  const moduleDef = db.scriptModule(moduleId);
  const notebook = moduleDef?.sourceNotebookId ? db.notebook(moduleDef.sourceNotebookId) : undefined;
  const revision = notebook && moduleDef?.sourceNotebookRev !== undefined
    ? db.revision(notebook.id, moduleDef.sourceNotebookRev)
    : undefined;
  return storedLibraryCopy(moduleId, db.libraryCopy(moduleId), moduleDef, notebook, revision);
}

/** The library folder is written first, so a module the database lists always has one. */
async function saveToLibrary(db: StudioStore, def: ModuleDef, copy?: ModuleLibraryCopy) {
  if (!db.moduleLibrary) return;
  try {
    await writeLibraryModule(def, db.moduleLibrary, copy);
  } catch (error) {
    if (error instanceof ModuleLibraryError) throw new HttpError(409, error.message);
    throw error;
  }
}

export async function handleNotebookApi(method: string, path: string[], request: Request, db: StudioStore = store()): Promise<Response> {
  ensureNotebookDemo(db);
  await ensureModuleLibrary(db);
  const files = await notebookFiles(db);
  const [resource, id, action, extra] = path;
  // Pick up edits made to the notebook files outside the app before anything reads them. A save checks instead.
  if (files && !(resource === "notebooks" && id && !action && method === "PUT")) {
    await files.refresh(db, resource === "notebooks" && id ? id : undefined);
  }
  /** Save a notebook to the database and its workspace file. */
  const saveNotebook = async (doc: NotebookDoc) => {
    if (files) {
      try {
        await files.write(doc);
      } catch (error) {
        if (error instanceof NotebookConflictError) throw new HttpError(409, error.message);
        throw error;
      }
    }
    const saved = db.saveNotebook(doc);
    // The database assigns rev and timestamps; the file only holds content, so it is already current.
    return saved;
  };

  if (resource === "kernels" && !id && method === "GET") return json(await listKernelSpecs());

  if (resource === "script-modules" && !id && method === "GET") {
    const revisions = allRevisions(db);
    return json({
      modules: scriptModuleViews(db.scriptModules(), db.notebooks(), revisions, db.workflows()),
      references: referenceCounts(db.workflows()),
    });
  }

  if (resource === "script-modules" && method === "PUT") {
    const moduleId = path.slice(1).join("/");
    if (!/^script\/[\w-]+\/v\d+$/.test(moduleId)) throw new HttpError(400, "无效的模块 id");
    const current = db.scriptModule(moduleId);
    if (!current) throw new HttpError(404, "模块不存在");
    const body = envSchema.parse(await request.json());
    let next;
    try {
      next = patchModuleEnv(current, body);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : "无法保存环境");
    }
    next = { ...next, environmentYml: await readEnvironmentYml(next.condaYaml) };
    await saveToLibrary(db, next, db.libraryCopy(next.id));
    db.saveScriptModule(next);
    const revisions = allRevisions(db);
    return json(scriptModuleViews([next], db.notebooks(), revisions, db.workflows())[0]);
  }

  if (resource === "script-modules" && id === "reopen" && method === "POST") {
    const body = reopenSchema.parse(await request.json());
    const copy = libraryForModule(db, body.moduleId);
    if (!copy) throw new HttpError(404, "这个模块没有可重建的库副本");
    if (!db.libraryCopy(copy.moduleId)) db.saveLibraryCopy(copy);
    let doc: NotebookDoc;
    try {
      doc = notebookFromLibrary(copy, newNotebookId(db));
    } catch (error) {
      if (error instanceof PercentError) throw new HttpError(400, error.message);
      throw error;
    }
    return json(await saveNotebook(doc), 201);
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
    return json(await saveNotebook(doc), 201);
  }

  if (!id) throw new HttpError(404, "接口不存在");
  if (!/^[\w-]{1,80}$/.test(id)) throw new HttpError(400, "无效的笔记本 id");

  if (!action && method === "GET") return json(requireNotebook(db, id));

  if (!action && method === "PUT") {
    const current = requireNotebook(db, id);
    const body = writeSchema.parse(await request.json());
    return json(await saveNotebook({
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
    requireNotebook(db, id);
    const revision = db.revision(id, rev);
    if (!revision) throw new HttpError(404, "这个修订不存在");
    return json(revision);
  }

  if (action === "run" && method === "POST") {
    const body = runSchema.parse(await request.json().catch(() => ({})));
    try {
      return json(await runNotebookCells(requireNotebook(db, id), body.cellId));
    } catch (error) {
      if (error instanceof ConvertError) throw new HttpError(400, error.message);
      throw error;
    }
  }

  if (action === "kernel" && method === "GET") {
    requireNotebook(db, id);
    return json(kernelInfo(id));
  }

  if (action === "kernel" && method === "POST") {
    const notebook = requireNotebook(db, id);
    const body = kernelActionSchema.parse(await request.json().catch(() => ({})));
    if (body.action === "interrupt") existingKernel(id)?.interrupt();
    if (body.action === "shutdown") shutdownKernel(id);
    if (body.action === "restart") {
      shutdownKernel(id);
      if (notebook.language !== "python") throw new HttpError(400, "R 笔记本本期没有常驻内核");
      try {
        await (await kernelFor(id, notebook.kernel)).whenReady();
      } catch (error) {
        if (error instanceof KernelUnavailableError) throw new HttpError(400, `${error.message}。安装 ipykernel 后再启动内核`);
        throw new HttpError(500, error instanceof Error ? error.message : "内核启动失败");
      }
    }
    return json(kernelInfo(id));
  }

  if (action === "try-run" && method === "POST") {
    const notebook = requireNotebook(db, id);
    const body = trySchema.parse(await request.json().catch(() => ({})));
    try {
      const record = await executeTryRun(notebook, body.bindings ?? [], {
        condaYaml: body.condaYaml,
        containerImage: body.containerImage,
      });
      db.saveTryRun(record);
      return json(record);
    } catch (error) {
      if (error instanceof ConvertError || error instanceof EnvFieldError) throw new HttpError(400, error.message);
      throw error;
    }
  }

  if (action === "publish" && method === "POST") {
    const notebook = requireNotebook(db, id);
    const body = publishSchema.parse(await request.json());
    let published: ReturnType<typeof publishScriptModule>;
    try {
      published = publishScriptModule({
        notebook,
        name: body.name,
        description: body.description ?? notebook.description,
        changelog: body.changelog,
        condaYaml: body.condaYaml,
        containerImage: body.containerImage,
        existing: db.scriptModules(),
        receipt: db.tryRun(notebook.id, notebook.rev),
      });
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : "无法发布");
    }
    published.module.environmentYml = await readEnvironmentYml(published.module.condaYaml);
    await saveToLibrary(db, published.module, published.library);
    db.transaction(() => {
      db.saveScriptModule(published.module);
      db.saveLibraryCopy(published.library);
    });
    const revisions = allRevisions(db);
    const view = scriptModuleViews([published.module], db.notebooks(), revisions, db.workflows())[0];
    return json(view, 201);
  }

  throw new HttpError(404, "接口不存在");
}
