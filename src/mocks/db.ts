/**
 * In-browser persistence for the mock backend. Data lives in localStorage
 * so saved workflows survive reloads while there is no real server.
 */
import { demoRnaseqWorkflow } from "@/features/workflow/demo";
import type { RunDetail } from "@/features/runs/types";
import type { WorkflowDoc } from "@/features/workflow/types";

const KEY = "nf-studio-mock-db";

/** Stored run: everything except the simulated, time-dependent state. */
export type StoredRun = Omit<RunDetail, "status" | "progress" | "startedAt" | "completedAt" | "errorMessage">;

interface MockDb {
  workflows: Record<string, WorkflowDoc>;
  runs: Record<string, StoredRun>;
}

let memory: MockDb | null = null;

function seed(): MockDb {
  const demo = demoRnaseqWorkflow("wf_demo_rnaseq");
  return { workflows: { [demo.id]: demo }, runs: {} };
}

export function readDb(): MockDb {
  if (memory) return memory;
  try {
    const raw = localStorage.getItem(KEY);
    memory = raw ? { ...seed(), ...(JSON.parse(raw) as Partial<MockDb>) } : seed();
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
