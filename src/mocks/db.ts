/**
 * In-browser persistence for the mock backend. Data lives in localStorage
 * so saved workflows survive reloads while there is no real server.
 */
import type { ModuleLibraryCopy } from "@/features/notebook/library-copy";
import { demoLibraryCopies, demoNotebooks, demoRevisions, demoScriptModules } from "@/features/notebook/seed";
import type { NotebookDoc, NotebookRevision, TryRunRecord } from "@/features/notebook/types";
import { demoWorkflow, dockingWorkflow } from "@/features/workflow/demo";
import { EXAMPLE_MODULES } from "@/features/workflow/example-modules";
import type { RunDetail } from "@/features/runs/types";
import type { ModuleDef, WorkflowDoc } from "@/features/workflow/types";
import type { Project } from "@/features/workspace/types";
import { EXAMPLE_PROJECT_ID } from "@/features/workspace/projects";

// Bumped when the seed changes shape, so old browsers start from the new seed.
const KEY = "nf-studio-mock-db-v2";

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
  projects: Record<string, Project>;
  currentProject?: string;
}

/** Folder of the mock example project; `fs.ts` lists it. */
export const MOCK_EXAMPLE_PROJECT_PATH = "/home/demo/projects/example";

let memory: MockDb | null = null;

function seed(): MockDb {
  const demo = demoWorkflow("wf_demo_scrna");
  const docking = dockingWorkflow("wf_demo_docking");
  const notebooks = demoNotebooks();
  const revisionsList = demoRevisions(notebooks);
  const revisions: Record<string, NotebookRevision> = {};
  for (const revision of revisionsList) revisions[`${revision.notebookId}:${revision.rev}`] = revision;
  const scriptList = demoScriptModules(notebooks, revisionsList);
  const scriptModules: Record<string, ModuleDef> = {};
  for (const mod of [...scriptList, ...EXAMPLE_MODULES]) scriptModules[mod.id] = mod;
  const libraryCopies: Record<string, ModuleLibraryCopy> = {};
  for (const copy of demoLibraryCopies(notebooks, revisionsList, scriptList)) libraryCopies[copy.moduleId] = copy;
  return {
    workflows: { [demo.id]: demo, [docking.id]: docking },
    runs: {},
    notebooks: Object.fromEntries(notebooks.map((doc) => [doc.id, doc])),
    revisions,
    scriptModules,
    libraryCopies,
    tryRuns: {},
    projects: {
      [EXAMPLE_PROJECT_ID]: { id: EXAMPLE_PROJECT_ID, name: "示例项目", path: MOCK_EXAMPLE_PROJECT_PATH, createdAt: "2026-01-01T00:00:00.000Z", openedAt: "1970-01-01T00:00:00.000Z", example: true },
    },
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
      projects: parsed.projects ?? base.projects,
      currentProject: parsed.currentProject,
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
