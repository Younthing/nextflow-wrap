/**
 * In-browser persistence for the mock backend. Data lives in localStorage
 * so saved workflows survive reloads while there is no real server.
 */
import { demoRnaseqWorkflow } from "@/features/workflow/demo";
import type { WorkflowDoc } from "@/features/workflow/types";

const KEY = "nf-studio-mock-db";

interface MockDb {
  workflows: Record<string, WorkflowDoc>;
}

let memory: MockDb | null = null;

function seed(): MockDb {
  const demo = demoRnaseqWorkflow("wf_demo_rnaseq");
  return { workflows: { [demo.id]: demo } };
}

export function readDb(): MockDb {
  if (memory) return memory;
  try {
    const raw = localStorage.getItem(KEY);
    memory = raw ? (JSON.parse(raw) as MockDb) : seed();
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
