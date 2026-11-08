import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { ConvertError } from "@/features/notebook/convert";
import { EnvFieldError, patchModuleEnv } from "@/features/notebook/env";
import { PercentError } from "@/features/notebook/jupytext";
import { serializeIpynb } from "@/features/notebook/ipynb";
import { notebookFromLibrary } from "@/features/notebook/library-copy";
import { publishScriptModule } from "@/features/notebook/publish";
import { exampleData, exampleLibraryCopies, exampleModules, exampleNotebooks, exampleWorkflow } from "@/features/notebook/examples";
import { IF_EXAMPLE_IMAGE, ifExampleNotebooks, ifExampleWorkflow } from "@/features/notebook/examples-if";
import { IF_SIDE_FILES, ifSideNotebooks, ifSideWorkflow } from "@/features/notebook/examples-if-side";
import { executeTryRun, runNotebookCells } from "@/features/notebook/execute";
import { readEnvironmentYml } from "@/features/notebook/server/environment-yml";
import { existingKernel, kernelFor, kernelInfo, KernelUnavailableError, listKernelSpecs, shutdownKernel } from "@/features/notebook/server/kernels";
import { listNotebookVariables, readNotebookVariable, VARIABLE_NAME } from "@/features/notebook/server/kernel-variables";
import { referenceCounts, scriptModuleViews, summarizeNotebook } from "@/features/notebook/library";
import { languageForKernel, type NotebookDoc } from "@/features/notebook/types";
import { HttpError } from "@/features/runs/server/service";
import { StudioStore } from "@/lib/server/database";
import { shareModule, installModule } from "./shared-modules";
import { dataDirectory, registryStore, store } from "@/lib/server/database";
import { EXAMPLE_PROJECT_ID, IF_EXAMPLE_PROJECT_ID } from "@/features/workspace/projects";


const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });

const cellSchema = z.object({
  id: z.string().min(1).max(80),
  role: z.enum(["code", "markdown", "input", "output", "explore"]),
  source: z.string().max(50_000),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const writeSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(2000).optional(),
  kernel: z.string().trim().min(1).max(80).refine((value) => !/[\u0000-\u001f]/.test(value), "内核名称不能包含换行"),
  cells: z.array(cellSchema).max(80),
  folder: z.string().max(4000).optional(),
  filePath: z.string().max(4000).optional(),
  fileVersion: z.string().max(100).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
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
  overwrite: z.string().trim().max(200).regex(/^modules\/[\w.-]+\/v\d+\/module\.json$/).optional(),
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
 * A new data directory starts with the example project: an ordinary project whose folder is the database's default
 * workspace, preset with four analysis notebooks, the modules exported from them, a workflow that chains them, and
 * the example data in `data/`. Once: removing the project or any of its content later does not bring it back.
 */
export function ensureExampleProject(db: StudioStore = store()) {
  if (db.projectRoot || db.meta("fileExamplesV2")) return;
  const base = join(db.dataDir ?? dataDirectory(), "example-projects-v2");
  const presets = [
    { id: EXAMPLE_PROJECT_ID, name: "示例项目", notebooks: exampleNotebooks(EXAMPLE_PROJECT_ID), workflows: [exampleWorkflow(EXAMPLE_PROJECT_ID)], assets: [] as { path: string; asset: readonly string[] }[] },
    { id: IF_EXAMPLE_PROJECT_ID, name: "免疫荧光分析示例", notebooks: [...ifExampleNotebooks(IF_EXAMPLE_PROJECT_ID), ...ifSideNotebooks(IF_EXAMPLE_PROJECT_ID)], workflows: [ifExampleWorkflow(IF_EXAMPLE_PROJECT_ID), ifSideWorkflow(IF_EXAMPLE_PROJECT_ID)], assets: [IF_EXAMPLE_IMAGE, ...IF_SIDE_FILES] },
  ];
  for (const preset of presets) {
    const folder = join(base, preset.id);
    mkdirSync(folder, { recursive: true });
    const now = new Date().toISOString();
    db.saveProject({ id: preset.id, name: preset.name, path: folder, createdAt: now, openedAt: now });
    const project = new StudioStore(join(folder, ".studio", "state.sqlite"), folder, preset.id);
    try {
      if (project.meta("seeded")) continue;
      for (const notebook of preset.notebooks) if (!project.notebook(notebook.id)) project.saveNotebook(notebook);
      const modules = exampleModules(preset.notebooks);
      for (const mod of modules) if (!project.scriptModule(mod.id)) project.saveScriptModule(mod);
      for (const [index, copy] of exampleLibraryCopies(preset.notebooks, modules).entries()) {
        if (!project.libraryCopy(copy.moduleId)) project.saveLibraryCopy(copy);
        const source = `${copy.moduleId.slice(0, -"module.json".length)}source.ipynb`;
        if (!existsSync(project.documents!.files.resolve(source))) project.documents!.files.write(source, serializeIpynb(preset.notebooks[index]), null);
      }
      for (const workflow of preset.workflows) if (!project.workflow(workflow.id)) project.saveWorkflow(workflow);
      for (const file of preset.id === EXAMPLE_PROJECT_ID ? exampleData() : []) {
        const path = join(folder, file.path);
        mkdirSync(dirname(path), { recursive: true });
        if (!existsSync(path)) writeFileSync(path, file.content);
      }
      for (const file of preset.assets) {
        const path = join(folder, file.path);
        mkdirSync(dirname(path), { recursive: true });
        if (!existsSync(path)) copyFileSync(join(/* turbopackIgnore: true */ process.cwd(), ...file.asset), path);
      }
      mkdirSync(join(folder, "results"), { recursive: true });
      project.setMeta("seeded", now);
    } finally { project.close(); }
  }
  db.setMeta("fileExamplesV2", new Date().toISOString());
}

export const ensureIfExampleProject = ensureExampleProject;

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

/**
 * Delete notebooks: their kernels stop, their files in the project folder go, and their rows leave the database.
 * Revisions stay for the modules published from them. A file already removed by the caller is fine.
 */
export async function deleteNotebooks(db: StudioStore, ids: string[]): Promise<void> {
  for (const id of ids) {
    const doc = db.notebook(id);
    if (!doc) continue;
    shutdownKernel(id);
    db.deleteNotebook(id);
  }
}

/** Notebooks of a project whose `.ipynb` files are at, or under, these workspace-relative paths. */
export async function notebooksAtPaths(db: StudioStore, projectId: string, paths: string[]): Promise<string[]> {
  if (db.documents) return db.notebooks().filter((doc) => doc.filePath && paths.some((path) => doc.filePath === path || doc.filePath!.startsWith(`${path}/`))).map((doc) => doc.id);
  return [];
}

function newNotebookId(db: StudioStore): string {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = `nb_${randomUUID().slice(0, 8)}`;
    if (!db.notebook(id)) return id;
  }
  throw new HttpError(500, "无法分配笔记本 id");
}

export async function handleNotebookApi(method: string, path: string[], request: Request, db: StudioStore = store()): Promise<Response> {
  const [resource, id, action, extra] = path;
  const saveNotebook = async (doc: NotebookDoc) => db.saveNotebook(doc);

  if (resource === "kernels" && !id && method === "GET") return json(await listKernelSpecs());

  if (resource === "script-modules" && id === "shared" && method === "GET") return json(registryStore().scriptModules());
  if (resource === "script-modules" && (id === "share" || id === "install") && method === "POST") {
    const body = editSchema.parse(await request.json());
    return json(id === "share" ? shareModule(db, registryStore(), body.moduleId) : installModule(registryStore(), db, body.moduleId), 201);
  }

  if (resource === "script-modules" && !id && method === "GET") {
    return json({
      modules: scriptModuleViews(db.scriptModules(), db.workflows()),
      references: referenceCounts(db.workflows()),
    });
  }

  if (resource === "script-modules" && method === "PUT") {
    const moduleId = path.slice(1).join("/");
    if (!/^modules\/[\w.-]+\/v\d+\/module\.json$/.test(moduleId)) throw new HttpError(400, "无效的模块 id");
    const current = db.scriptModule(moduleId);
    if (!current) throw new HttpError(404, "模块不存在");
    if (db.documents) throw new HttpError(409, "已发布版本不可修改，请从来源笔记本发布新版本");
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
    const projectId = db.projectHandle;
    if (!projectId) throw new HttpError(400, "先打开一个项目");
    let doc: NotebookDoc;
    try {
      doc = notebookFromLibrary(copy, newNotebookId(db), projectId);
      delete doc.temporary;
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
    const projectId = body.projectId ?? db.projectHandle;
    if (!projectId || !db.project(projectId)) throw new HttpError(400, "先打开一个项目");
    const now = new Date().toISOString();
    const doc: NotebookDoc = {
      id: `nb_${randomUUID().slice(0, 8)}`,
      projectId,
      filePath: body.filePath ?? (body.folder !== undefined ? db.documents?.files.available(body.folder, body.name, ".ipynb") : undefined),
      metadata: body.metadata,
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

  if (!action && method === "DELETE") {
    requireNotebook(db, id);
    await deleteNotebooks(db, [id]);
    return new Response(null, { status: 204 });
  }

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
      fileVersion: body.fileVersion,
      metadata: body.metadata ?? current.metadata,
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

  // Variables of the running kernel. Read-only: never starts a kernel and leaves the execution count alone.
  if (action === "variables" && method === "GET") {
    const notebook = requireNotebook(db, id);
    const name = new URL(request.url).searchParams.get("name")?.trim();
    if (!name) return json(await listNotebookVariables(notebook));
    if (!VARIABLE_NAME.test(name)) throw new HttpError(400, `变量名无效：${name}`);
    return json(await readNotebookVariable(notebook, name));
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
      }, { workspace: workspaceOf(db, notebook) });
      record.fileVersion = notebook.fileVersion;
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
      db.documents?.files.write(`${published.module.id.slice(0, -"module.json".length)}source.ipynb`, serializeIpynb(notebook), null);
    });
    return json(scriptModuleViews([published.module], db.workflows())[0], 201);
  }

  throw new HttpError(404, "接口不存在");
}
