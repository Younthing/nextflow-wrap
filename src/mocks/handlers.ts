import { delay, http, HttpResponse } from "msw";

import catalog from "@/data/nf-core-modules.json";
import samplesheetSchema from "@/data/samplesheet-schema.json";
import { newId } from "@/features/workflow/nodes";
import { workflowWriteIsStale } from "@/features/workflow/revision";
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
    const current = readDb().workflows[id];
    if (!current) return notFound();
    const body = (await request.json()) as WorkflowDoc;
    if (workflowWriteIsStale(current, body)) {
      return HttpResponse.json({ message: "流程已在其他地方更新，请重新打开" }, { status: 409 });
    }
    const doc: WorkflowDoc = { ...body, id, updatedAt: new Date().toISOString() };
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
