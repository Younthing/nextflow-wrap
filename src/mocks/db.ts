/**
 * In-browser persistence for the mock backend. Data lives in localStorage
 * so saved workflows survive reloads while there is no real server.
 */
import { demoNotebooks, demoRevisions, demoScriptModules } from "@/features/notebook/seed";
import type { NotebookDoc, NotebookRevision, TryRunRecord } from "@/features/notebook/types";
import { demoRnaseqWorkflow } from "@/features/workflow/demo";
import type { RunDetail } from "@/features/runs/types";
import type { ModuleDef, WorkflowDoc } from "@/features/workflow/types";

const KEY = "nf-studio-mock-db";

/** Stored run: everything except the simulated, time-dependent state. */
export type StoredRun = Omit<RunDetail, "status" | "progress" | "startedAt" | "completedAt" | "errorMessage">;

interface MockDb {
  workflows: Record<string, WorkflowDoc>;
  runs: Record<string, StoredRun>;
  notebooks: Record<string, NotebookDoc>;
  revisions: Record<string, NotebookRevision>;
  scriptModules: Record<string, ModuleDef>;
  tryRuns: Record<string, TryRunRecord>;
}

let memory: MockDb | null = null;

function seed(): MockDb {
  const demo = demoRnaseqWorkflow("wf_demo_rnaseq");
  const notebooks = demoNotebooks();
  const revisions: Record<string, NotebookRevision> = {};
  for (const revision of demoRevisions(notebooks)) revisions[`${revision.notebookId}:${revision.rev}`] = revision;
  const scriptModules: Record<string, ModuleDef> = {};
  for (const mod of demoScriptModules(notebooks)) scriptModules[mod.id] = mod;
  return {
    workflows: { [demo.id]: demo },
    runs: {},
    notebooks: Object.fromEntries(notebooks.map((doc) => [doc.id, doc])),
    revisions,
    scriptModules,
    tryRuns: {},
  };
}

export function readDb(): MockDb {
  if (memory) return memory;
  try {
    const raw = localStorage.getItem(KEY);
    const base = seed();
    const parsed = raw ? (JSON.parse(raw) as Partial<MockDb>) : {};
    memory = {
      workflows: parsed.workflows ?? base.workflows,
      runs: parsed.runs ?? base.runs,
      notebooks: parsed.notebooks ?? base.notebooks,
      revisions: parsed.revisions ?? base.revisions,
      scriptModules: parsed.scriptModules ?? base.scriptModules,
      tryRuns: parsed.tryRuns ?? base.tryRuns,
    };
  } catch {
    memory = seed();
  }
  return memory;
}

export function writeDb(update: (db: MockDb) => void) {
  const db = readDb();
  update(db);
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    // Storage may be full or disabled; keep the in-memory copy.
  }
}
