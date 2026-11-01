import { delay, http, HttpResponse } from "msw";

import catalog from "@/data/nf-core-modules.json";
import samplesheetSchema from "@/data/samplesheet-schema.json";
import { referenceCounts, scriptModuleViews, summarizeNotebook } from "@/features/notebook/library";
import { buildScriptModule } from "@/features/notebook/publish";
import { simulateCells, simulateTryRun, withSampleValues } from "@/features/notebook/simulate";
import { languageForKernel, type NotebookDoc } from "@/features/notebook/types";
import { newId } from "@/features/workflow/nodes";
import { commitWorkflowPut } from "@/features/workflow/revision";
import type { ModuleCatalog, WorkflowDoc, WorkflowSummary } from "@/features/workflow/types";
import type { HealthStatus } from "@/lib/api-types";
import { readDb, writeDb } from "./db";
import { runHandlers } from "./runs";

const summarize = (w: WorkflowDoc): WorkflowSummary => ({
  id: w.id,
  name: w.name,
  description: w.description,
  updatedAt: w.updatedAt,
  nodeCount: w.nodes.length,
});

const notFound = () => HttpResponse.json({ message: "流程不存在" }, { status: 404 });

export const handlers = [
  http.get("/api/health", async () => {
    await delay(150);
    return HttpResponse.json<HealthStatus>({
      status: "ok",
      nextflowVersion: "25.10.0",
      mocked: true,
    });
  }),

  http.get("/api/modules", async () => {
    await delay(200);
    return HttpResponse.json(catalog as ModuleCatalog);
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

  http.post("/api/notebooks/:id/run", async ({ params }) => {
    await delay(200);
    const doc = readDb().notebooks[params.id as string];
    if (!doc) return HttpResponse.json({ message: "笔记本不存在" }, { status: 404 });
    return HttpResponse.json({ cells: simulateCells(doc) });
  }),

  http.post("/api/notebooks/:id/try-run", async ({ params, request }) => {
    await delay(300);
    const doc = readDb().notebooks[params.id as string];
    if (!doc) return HttpResponse.json({ message: "笔记本不存在" }, { status: 404 });
    const body = (await request.json().catch(() => ({}))) as { args?: Record<string, string>; sampleId?: "fastqc-pair" | "samplesheet" };
    const record = simulateTryRun(doc, withSampleValues(body.args ?? {}, body.sampleId));
    writeDb((db) => {
      db.tryRuns[`${doc.id}:${doc.rev}`] = record;
    });
    return HttpResponse.json(record);
  }),

  http.post("/api/notebooks/:id/publish", async ({ params, request }) => {
    const id = params.id as string;
    const doc = readDb().notebooks[id];
    if (!doc) return HttpResponse.json({ message: "笔记本不存在" }, { status: 404 });
    const body = (await request.json()) as { name?: string; description?: string; changelog?: string };
    try {
      const moduleDef = buildScriptModule({
        notebook: doc,
        name: body.name || doc.name,
        description: body.description || doc.description,
        changelog: body.changelog,
        existing: Object.values(readDb().scriptModules),
        receipt: readDb().tryRuns[`${id}:${doc.rev}`],
      });
      writeDb((db) => {
        db.scriptModules[moduleDef.id] = moduleDef;
      });
      const db = readDb();
      const view = scriptModuleViews([moduleDef], Object.values(db.notebooks), Object.values(db.revisions), Object.values(db.workflows))[0];
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
