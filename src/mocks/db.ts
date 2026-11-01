/**
 * In-browser persistence for the mock backend. Data lives in localStorage
 * so saved workflows survive reloads while there is no real server.
 */
import type { ModuleLibraryCopy } from "@/features/notebook/library-copy";
import { demoLibraryCopies, demoNotebooks, demoRevisions, demoScriptModules } from "@/features/notebook/seed";
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
  libraryCopies: Record<string, ModuleLibraryCopy>;
  tryRuns: Record<string, TryRunRecord>;
}

let memory: MockDb | null = null;

function seed(): MockDb {
  const demo = demoRnaseqWorkflow("wf_demo_rnaseq");
  const notebooks = demoNotebooks();
  const revisionsList = demoRevisions(notebooks);
  const revisions: Record<string, NotebookRevision> = {};
  for (const revision of revisionsList) revisions[`${revision.notebookId}:${revision.rev}`] = revision;
  const scriptList = demoScriptModules(notebooks, revisionsList);
  const scriptModules: Record<string, ModuleDef> = {};
  for (const mod of scriptList) scriptModules[mod.id] = mod;
  const libraryCopies: Record<string, ModuleLibraryCopy> = {};
  for (const copy of demoLibraryCopies(notebooks, revisionsList, scriptList)) libraryCopies[copy.moduleId] = copy;
  return {
    workflows: { [demo.id]: demo },
    runs: {},
    notebooks: Object.fromEntries(notebooks.map((doc) => [doc.id, doc])),
    revisions,
    scriptModules,
    libraryCopies,
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
      libraryCopies: parsed.libraryCopies ?? base.libraryCopies,
      tryRuns: parsed.tryRuns ?? base.tryRuns,
    };
  } catch {
    memory = seed();
  }
  return memory;
}

export function writeDb(update: (db: MockDb) => void) {
  const db = readDb();
  db.libraryCopies ??= {};
  update(db);
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    // Storage may be full or disabled; keep the in-memory copy.
  }
}
