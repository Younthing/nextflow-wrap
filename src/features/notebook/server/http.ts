import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { ConvertError } from "@/features/notebook/convert";
import { EnvFieldError, patchModuleEnv } from "@/features/notebook/env";
import { PercentError } from "@/features/notebook/jupytext";
import { notebookFromLibrary } from "@/features/notebook/library-copy";
import { publishScriptModule } from "@/features/notebook/publish";
import { exampleData, exampleLibraryCopies, exampleModules, exampleNotebooks, exampleWorkflow } from "@/features/notebook/examples";
import { executeTryRun, runNotebookCells } from "@/features/notebook/execute";
import { NotebookConflictError, notebookFiles } from "@/features/notebook/server/notebook-files";
import { readEnvironmentYml } from "@/features/notebook/server/environment-yml";
import { existingKernel, kernelFor, kernelInfo, KernelUnavailableError, listKernelSpecs, shutdownKernel } from "@/features/notebook/server/kernels";
import { referenceCounts, scriptModuleViews, summarizeNotebook } from "@/features/notebook/library";
import { languageForKernel, type NotebookDoc } from "@/features/notebook/types";
import { HttpError } from "@/features/runs/server/service";
import type { StudioStore } from "@/lib/server/database";
import { dataDirectory, store } from "@/lib/server/database";
import { EXAMPLE_PROJECT_ID } from "@/features/workspace/projects";
import { currentProjectId } from "@/features/workspace/server/projects";

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
  projectId: z.string().regex(/^[\w-]{1,80}$/).optional(),
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
  /** Module id to overwrite; a new module when unset. */
  overwrite: z.string().trim().max(200).regex(/^script\/[\w.-]+$/).optional(),
  description: z.string().max(2000).optional(),
  changelog: z.string().max(2000).optional(),
  condaYaml: envField.optional(),
  containerImage: envField.optional(),
});

const envSchema = z.object({
  condaYaml: envField.optional(),
  containerImage: envField.optional(),
});

const editSchema = z.object({
  moduleId: z.string().trim().min(1).max(200).regex(/^[\w./-]+$/),
});

/**
 * The example project is always there: a project row whose folder is the database's default workspace. A new
 * data directory also gets its content once: four analysis notebooks, the modules exported from them, a workflow
 * that chains them, and the example data in `data/`. Deleting them later does not bring them back.
 */
export function ensureExampleProject(db: StudioStore = store()) {
  const folder = db.workspace ?? join(dataDirectory(), "projects", "example");
  if (!db.project(EXAMPLE_PROJECT_ID)) {
    mkdirSync(folder, { recursive: true });
    // Older than anything the user opens, so it sits at the bottom of the recent list until it is used.
    db.saveProject({ id: EXAMPLE_PROJECT_ID, name: "示例项目", path: folder, createdAt: new Date().toISOString(), openedAt: "1970-01-01T00:00:00.000Z", example: true });
  }
  if (db.meta(EXAMPLE_SEEDED)) return;
  const notebooks = exampleNotebooks(EXAMPLE_PROJECT_ID);
  const modules = exampleModules(notebooks);
  const copies = exampleLibraryCopies(notebooks, modules);
  db.transaction(() => {
    if (db.meta(EXAMPLE_SEEDED)) return;
    for (const doc of notebooks) {
      db.insertNotebookSnapshot(doc);
      db.saveRevision({ notebookId: doc.id, rev: doc.rev, cells: doc.cells, savedAt: doc.updatedAt });
    }
    for (const mod of modules) db.saveScriptModule(mod);
    for (const copy of copies) db.saveLibraryCopy(copy);
    db.saveWorkflow(exampleWorkflow(EXAMPLE_PROJECT_ID));
    db.setMeta(EXAMPLE_SEEDED, new Date().toISOString());
  });
  // The data the notebooks and the workflow read. Existing files are kept.
  for (const file of exampleData()) {
    const path = join(folder, file.path);
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, file.content, { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
}

const EXAMPLE_SEEDED = "exampleSeeded";

function requireNotebook(db: StudioStore, id: string): NotebookDoc {
  const doc = db.notebook(id);
  if (!doc) throw new HttpError(404, "笔记本不存在");
  return doc;
}

/** The project folder a notebook's cells run in, so they read workspace paths such as `data/reads.fq`. */
function workspaceOf(db: StudioStore, doc: NotebookDoc): string | undefined {
  const projectId = doc.projectId;
  return db.project(projectId)?.path;
}

function newNotebookId(db: StudioStore): string {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = `nb_${randomUUID().slice(0, 8)}`;
    if (!db.notebook(id)) return id;
  }
  throw new HttpError(500, "无法分配笔记本 id");
}

export async function handleNotebookApi(method: string, path: string[], request: Request, db: StudioStore = store()): Promise<Response> {
  ensureExampleProject(db);
  const [resource, id, action, extra] = path;
  // Each project's notebooks live as `.ipynb` files in its folder. Pick up edits made outside the app before
  // anything reads them; a save checks instead.
  const filesOf = (doc: NotebookDoc) => notebookFiles(db, doc.projectId);
  if (resource === "notebooks" && id && !(method === "PUT" && !action)) {
    const doc = db.notebook(id);
    if (doc) await (await filesOf(doc))?.refresh(db, id);
  } else if (resource === "notebooks" && !id && method === "GET") {
    const project = new URL(request.url).searchParams.get("project");
    const ids = project ? [project] : [...new Set(db.notebooks().map((doc) => doc.projectId))];
    for (const projectId of ids) await (await notebookFiles(db, projectId))?.refresh(db);
  }
  /** Save a notebook to the database and, unless it is temporary, to the file in its project folder. */
  const saveNotebook = async (doc: NotebookDoc) => {
    const files = doc.temporary ? undefined : await filesOf(doc);
    if (files) {
      try {
        await files.write(doc);
      } catch (error) {
        if (error instanceof NotebookConflictError) throw new HttpError(409, error.message);
        throw error;
      }
    }
    // The database assigns rev and timestamps; the file only holds content, so it is already current.
    return db.saveNotebook(doc);
  };

  if (resource === "kernels" && !id && method === "GET") return json(await listKernelSpecs());

  if (resource === "script-modules" && !id && method === "GET") {
    return json({
      modules: scriptModuleViews(db.scriptModules(), db.workflows()),
      references: referenceCounts(db.workflows()),
    });
  }

  if (resource === "script-modules" && method === "PUT") {
    const moduleId = path.slice(1).join("/");
    if (!/^script\/[\w.-]+$/.test(moduleId)) throw new HttpError(400, "无效的模块 id");
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
    db.saveScriptModule(next);
    return json(scriptModuleViews([next], db.workflows())[0]);
  }

  // Edit a module: a temporary notebook from the copy saved with it, in the open project.
  if (resource === "script-modules" && id === "edit" && method === "POST") {
    const body = editSchema.parse(await request.json());
    const copy = db.libraryCopy(body.moduleId);
    if (!copy) throw new HttpError(404, "这个模块没有可编辑的笔记本副本");
    const projectId = currentProjectId(db);
    if (!projectId) throw new HttpError(400, "先打开一个项目");
    let doc: NotebookDoc;
    try {
      doc = notebookFromLibrary(copy, newNotebookId(db), projectId);
    } catch (error) {
      if (error instanceof PercentError) throw new HttpError(400, error.message);
      throw error;
    }
    return json(await saveNotebook(doc), 201);
  }

  if (resource !== "notebooks") throw new HttpError(404, "接口不存在");

  if (!id && method === "GET") {
    const project = new URL(request.url).searchParams.get("project");
    return json(db.notebooks().filter((doc) => !doc.temporary && (!project || doc.projectId === project)).map(summarizeNotebook));
  }

  if (!id && method === "POST") {
    const body = writeSchema.parse(await request.json());
    // Notebooks belong to a project, as workflows do: their cells run in its folder.
    const projectId = body.projectId ?? currentProjectId(db);
    if (!projectId || !db.project(projectId)) throw new HttpError(400, "先打开一个项目");
    const now = new Date().toISOString();
    const doc: NotebookDoc = {
      id: `nb_${randomUUID().slice(0, 8)}`,
      projectId,
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

  // Keep a temporary notebook: it joins the project's notebooks and gets its file.
  if (action === "keep" && method === "POST") {
    const current = requireNotebook(db, id);
    if (!current.temporary) return json(current);
    const kept: NotebookDoc = { ...current };
    delete kept.temporary;
    return json(await saveNotebook(kept));
  }

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
      const notebook = requireNotebook(db, id);
      return json(await runNotebookCells(notebook, body.cellId, workspaceOf(db, notebook)));
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
      const r = notebook.language !== "python";
      try {
        await (await kernelFor(id, notebook.kernel, r ? "r" : "python", workspaceOf(db, notebook))).whenReady();
      } catch (error) {
        if (error instanceof KernelUnavailableError) throw new HttpError(400, `${error.message}。${r ? "安装 IRkernel" : "安装 ipykernel"} 后再启动内核`);
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
        overwrite: body.overwrite,
        receipt: db.tryRun(notebook.id, notebook.rev),
      });
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : "无法发布");
    }
    published.module.environmentYml = await readEnvironmentYml(published.module.condaYaml);
    db.transaction(() => {
      db.saveScriptModule(published.module);
      db.saveLibraryCopy(published.library);
    });
    return json(scriptModuleViews([published.module], db.workflows())[0], 201);
  }

  throw new HttpError(404, "接口不存在");
}
