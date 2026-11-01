import { delay, http, HttpResponse } from "msw";

import samplesheetSchema from "@/data/samplesheet-schema.json";
import { patchModuleEnv, readModuleEnv } from "@/features/notebook/env";
import type { PortBindingRequest } from "@/features/notebook/input-bindings";
import { PercentError } from "@/features/notebook/jupytext";
import { referenceCounts, scriptModuleViews, summarizeNotebook } from "@/features/notebook/library";
import { notebookFromLibrary, storedLibraryCopy } from "@/features/notebook/library-copy";
import { publishScriptModule } from "@/features/notebook/publish";
import { simulateCells, simulateTryRun } from "@/features/notebook/simulate";
import { languageForKernel, type NotebookDoc } from "@/features/notebook/types";
import { newId } from "@/features/workflow/nodes";
import { commitWorkflowPut } from "@/features/workflow/revision";
import type { WorkflowDoc, WorkflowSummary } from "@/features/workflow/types";
import { NEXTFLOW_VERSION } from "@/features/project/templates";
import type { HealthStatus } from "@/lib/api-types";
import { readDb, writeDb } from "./db";
import { kernelHandlers } from "./kernels";
import { runHandlers } from "./runs";
import { setupHandlers } from "./setup";
import { fsHandlers } from "./fs";
import { settingsHandlers } from "./settings";

const summarize = (w: WorkflowDoc): WorkflowSummary => ({
  id: w.id,
  name: w.name,
  description: w.description,
  updatedAt: w.updatedAt,
  nodeCount: w.nodes.length,
});

const notFound = () => HttpResponse.json({ message: "流程不存在" }, { status: 404 });

export const handlers = [
  ...kernelHandlers,
  ...setupHandlers,
  ...fsHandlers,
  ...settingsHandlers,
  http.get("/api/health", async () => {
    await delay(150);
    return HttpResponse.json<HealthStatus>({
      status: "ok",
      nextflowVersion: NEXTFLOW_VERSION,
      mocked: true,
    });
  }),

  http.post("/api/script-modules/reopen", async ({ request }) => {
    const body = (await request.json()) as { moduleId?: string };
    const moduleId = body.moduleId ?? "";
    const db = readDb();
    const moduleDef = db.scriptModules[moduleId];
    const notebook = moduleDef?.sourceNotebookId ? db.notebooks[moduleDef.sourceNotebookId] : undefined;
    const revision = notebook && moduleDef?.sourceNotebookRev !== undefined
      ? db.revisions[`${notebook.id}:${moduleDef.sourceNotebookRev}`]
      : undefined;
    const copy = storedLibraryCopy(moduleId, db.libraryCopies[moduleId], moduleDef, notebook, revision);
    if (!copy) return HttpResponse.json({ message: "这个模块没有可重建的库副本" }, { status: 404 });
    try {
      const doc = notebookFromLibrary(copy, newId("nb"));
      writeDb((next) => {
        next.libraryCopies[copy.moduleId] = copy;
        next.notebooks[doc.id] = doc;
        next.revisions[`${doc.id}:1`] = { notebookId: doc.id, rev: 1, cells: doc.cells, savedAt: doc.updatedAt };
      });
      return HttpResponse.json(doc, { status: 201 });
    } catch (error) {
      const message = error instanceof PercentError || error instanceof Error ? error.message : "无法重建";
      return HttpResponse.json({ message }, { status: 400 });
    }
  }),

  http.get("/api/script-modules", async () => {
    await delay(80);
    const db = readDb();
    const notebooks = Object.values(db.notebooks);
    const revisions = Object.values(db.revisions);
    const modules = Object.values(db.scriptModules);
    const workflows = Object.values(db.workflows);
    return HttpResponse.json({
      modules: scriptModuleViews(modules, notebooks, revisions, workflows),
      references: referenceCounts(workflows),
    });
  }),

  http.get("/api/notebooks", async () => {
    await delay(80);
    const db = readDb();
    const modules = Object.values(db.scriptModules);
    const list = Object.values(db.notebooks)
      .map((doc) => summarizeNotebook(doc, modules))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return HttpResponse.json(list);
  }),

  http.post("/api/notebooks", async ({ request }) => {
    const body = (await request.json()) as Partial<NotebookDoc>;
    const now = new Date().toISOString();
    const doc: NotebookDoc = {
      id: newId("nb"),
      name: String(body.name || "未命名笔记本").slice(0, 80),
      description: String(body.description ?? ""),
      kernel: String(body.kernel || "py311-pandas"),
      language: languageForKernel(String(body.kernel || "py311-pandas")),
      cells: body.cells?.length ? body.cells : [{ id: newId("c"), role: "code", source: "" }],
      rev: 1,
      createdAt: now,
      updatedAt: now,
    };
    writeDb((db) => {
      db.notebooks[doc.id] = doc;
      db.revisions[`${doc.id}:1`] = { notebookId: doc.id, rev: 1, cells: doc.cells, savedAt: now };
    });
    return HttpResponse.json(doc, { status: 201 });
  }),

  http.get("/api/notebooks/:id", async ({ params }) => {
    await delay(60);
    const doc = readDb().notebooks[params.id as string];
    return doc ? HttpResponse.json(doc) : HttpResponse.json({ message: "笔记本不存在" }, { status: 404 });
  }),

  http.put("/api/notebooks/:id", async ({ params, request }) => {
    const id = params.id as string;
    const current = readDb().notebooks[id];
    if (!current) return HttpResponse.json({ message: "笔记本不存在" }, { status: 404 });
    const body = (await request.json()) as NotebookDoc;
    const cellsChanged = JSON.stringify(current.cells) !== JSON.stringify(body.cells);
    const doc: NotebookDoc = {
      ...current,
      name: body.name || current.name,
      description: body.description ?? current.description,
      kernel: body.kernel || current.kernel,
      language: languageForKernel(body.kernel || current.kernel),
      cells: body.cells ?? current.cells,
      rev: cellsChanged ? current.rev + 1 : current.rev,
      updatedAt: new Date().toISOString(),
    };
    writeDb((db) => {
      db.notebooks[id] = doc;
      if (cellsChanged) {
        db.revisions[`${id}:${doc.rev}`] = { notebookId: id, rev: doc.rev, cells: doc.cells, savedAt: doc.updatedAt };
      }
    });
    return HttpResponse.json(doc);
  }),

  http.get("/api/notebooks/:id/revisions/:rev", ({ params }) => {
    const revision = readDb().revisions[`${params.id as string}:${params.rev as string}`];
    return revision ? HttpResponse.json(revision) : HttpResponse.json({ message: "这个修订不存在" }, { status: 404 });
  }),

  http.post("/api/notebooks/:id/run", async ({ params, request }) => {
    await delay(200);
    const doc = readDb().notebooks[params.id as string];
    if (!doc) return HttpResponse.json({ message: "笔记本不存在" }, { status: 404 });
    const body = (await request.json().catch(() => ({}))) as { cellId?: string };
    try {
      return HttpResponse.json({ cells: simulateCells(doc, body.cellId) });
    } catch (error) {
      return HttpResponse.json({ message: error instanceof Error ? error.message : "运行失败" }, { status: 400 });
    }
  }),

  http.post("/api/notebooks/:id/try-run", async ({ params, request }) => {
    await delay(300);
    const doc = readDb().notebooks[params.id as string];
    if (!doc) return HttpResponse.json({ message: "笔记本不存在" }, { status: 404 });
    const body = (await request.json().catch(() => ({}))) as {
      bindings?: PortBindingRequest[];
      condaYaml?: string;
      containerImage?: string;
    };
    let env;
    try {
      env = readModuleEnv({ condaYaml: body.condaYaml, containerImage: body.containerImage });
    } catch (error) {
      return HttpResponse.json({ message: error instanceof Error ? error.message : "环境无效" }, { status: 400 });
    }
    const record = simulateTryRun(doc, body.bindings ?? [], env);
    writeDb((db) => {
      db.tryRuns[`${doc.id}:${doc.rev}`] = record;
    });
    return HttpResponse.json(record);
  }),

  http.put("/api/script-modules/:scope/:notebookId/:version", async ({ params, request }) => {
    const id = `${params.scope}/${params.notebookId}/${params.version}`;
    const current = readDb().scriptModules[id];
    if (!current) return HttpResponse.json({ message: "模块不存在" }, { status: 404 });
    const body = (await request.json()) as { condaYaml?: string; containerImage?: string };
    try {
      const next = patchModuleEnv(current, body);
      writeDb((db) => {
        db.scriptModules[id] = next;
      });
      const saved = readDb();
      const view = scriptModuleViews([next], Object.values(saved.notebooks), Object.values(saved.revisions), Object.values(saved.workflows))[0];
      return HttpResponse.json(view);
    } catch (error) {
      return HttpResponse.json({ message: error instanceof Error ? error.message : "无法保存环境" }, { status: 400 });
    }
  }),

  http.post("/api/notebooks/:id/publish", async ({ params, request }) => {
    const id = params.id as string;
    const doc = readDb().notebooks[id];
    if (!doc) return HttpResponse.json({ message: "笔记本不存在" }, { status: 404 });
    const body = (await request.json()) as { name?: string; description?: string; changelog?: string; condaYaml?: string; containerImage?: string };
    try {
      const published = publishScriptModule({
        notebook: doc,
        name: body.name || doc.name,
        description: body.description || doc.description,
        changelog: body.changelog,
        condaYaml: body.condaYaml,
        containerImage: body.containerImage,
        existing: Object.values(readDb().scriptModules),
        receipt: readDb().tryRuns[`${id}:${doc.rev}`],
      });
      writeDb((db) => {
        db.scriptModules[published.module.id] = published.module;
        db.libraryCopies[published.library.moduleId] = published.library;
      });
      const db = readDb();
      const view = scriptModuleViews([published.module], Object.values(db.notebooks), Object.values(db.revisions), Object.values(db.workflows))[0];
      return HttpResponse.json(view, { status: 201 });
    } catch (error) {
      return HttpResponse.json({ message: error instanceof Error ? error.message : "无法发布" }, { status: 400 });
    }
  }),

  http.get("/api/schemas/samplesheet", () => HttpResponse.json(samplesheetSchema)),

  http.get("/api/workflows", async () => {
    await delay(120);
    const list = Object.values(readDb().workflows)
      .map(summarize)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return HttpResponse.json(list);
  }),

  http.post("/api/workflows", async ({ request }) => {
    const body = (await request.json()) as WorkflowDoc;
    const doc: WorkflowDoc = { ...body, id: newId("wf"), updatedAt: new Date().toISOString() };
    writeDb((db) => {
      db.workflows[doc.id] = doc;
    });
    return HttpResponse.json(doc, { status: 201 });
  }),

  http.get("/api/workflows/:id", async ({ params }) => {
    await delay(120);
    const doc = readDb().workflows[params.id as string];
    return doc ? HttpResponse.json(doc) : notFound();
  }),

  http.put("/api/workflows/:id", async ({ params, request }) => {
    const id = params.id as string;
    const body = (await request.json()) as WorkflowDoc;
    const result = commitWorkflowPut(readDb().workflows[id], { ...body, id });
    if (result.status === "missing") return notFound();
    if (result.status === "stale") {
      return HttpResponse.json({ message: "流程已在其他地方更新，请重新打开" }, { status: 409 });
    }
    const doc = result.doc;
    writeDb((db) => {
      db.workflows[id] = doc;
    });
    return HttpResponse.json(doc);
  }),

  http.delete("/api/workflows/:id", ({ params }) => {
    const id = params.id as string;
    if (!readDb().workflows[id]) return notFound();
    writeDb((db) => {
      delete db.workflows[id];
    });
    return new HttpResponse(null, { status: 204 });
  }),

  ...runHandlers,
];
