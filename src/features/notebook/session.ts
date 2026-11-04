import { createStore, type StoreApi } from "zustand/vanilla";

import { notebookDraftKey } from "./edit";
import type { CellRunResult, NotebookCell, NotebookDoc, NotebookRunKernel, NotebookRunResult } from "./types";

/*
 * One open notebook, independent of the component that draws it — the role of
 * VS Code's NotebookDocument plus its kernel provider. The editor renders and
 * drives it; the assistant's notebook tools read and edit through the same
 * object. Edits autosave after a pause; runs save a dirty draft first, the way
 * Shift+Enter does.
 */

export const NOTEBOOK_AUTOSAVE_MS = 700;

export interface NotebookSessionState {
  /** Last copy the server confirmed. `null` until the notebook loads. */
  saved: NotebookDoc | null;
  /** Unsaved edits. `null` when the saved copy is current. */
  draft: NotebookDoc | null;
  /** Output shown under each cell, by cell id. */
  outputs: Readonly<Record<string, CellRunResult>>;
  durations: Readonly<Record<string, number>>;
  /** Cell being run, `all` for Run All, or `null`. */
  running: string | "all" | null;
  /** Saves in flight. */
  saving: number;
  kernel: NotebookRunKernel | null;
  saveError: string | null;
  runError: string | null;
}

/** What a tool sees: the latest doc (unsaved edits included), outputs, and whether a save or run holds the session. */
export interface NotebookSnapshot {
  doc: NotebookDoc;
  outputs: Readonly<Record<string, CellRunResult>>;
  busy: boolean;
}

/** Server calls the session makes. The provider wires them to the notebook queries. */
export interface NotebookSessionPorts {
  save(doc: NotebookDoc): Promise<NotebookDoc>;
  run(request: { id: string; cellId?: string }): Promise<NotebookRunResult>;
}

export interface NotebookSession {
  readonly notebookId: string;
  readonly store: StoreApi<NotebookSessionState>;
  /** Draft if dirty, else the saved copy. */
  doc(): NotebookDoc | null;
  /** Latest doc, outputs, and busy flag. Throws before the notebook loads. */
  read(): NotebookSnapshot;
  isBusy(): boolean;
  /** Server copy from the notebook query. */
  setSaved(doc: NotebookDoc): void;
  connect(ports: NotebookSessionPorts): void;
  /** Applies one edit to the draft and schedules an autosave. */
  update(patch: Partial<NotebookDoc>): void;
  /** Replaces the cells as one edit and asks editors to reveal `select`. */
  setCells(cells: NotebookCell[], select?: string): void;
  /** Editors listen to show the cell a tool touched. */
  onReveal(listener: (cellId: string) => void): () => void;
  clearOutput(cellId?: string): void;
  /** Run All: restart and run every cell. Errors land in `runError`. */
  runAll(): void;
  /** Saves a dirty draft, then runs `cellId` when given. Rejects with the save or run error. */
  saveThenRun(cellId: string | null): Promise<NotebookRunResult | undefined>;
  /** Saves and runs one cell like Shift+Enter, refusing while busy. */
  runCell(cellId: string): Promise<NotebookRunResult>;
  /** Saves a dirty draft now. */
  flush(): Promise<void>;
  /** Drops a pending autosave. */
  dispose(): void;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function omit<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

export function createNotebookSession(options: {
  notebookId: string;
  saved?: NotebookDoc | null;
  ports?: NotebookSessionPorts;
  clock?: () => number;
  autosaveMs?: number;
}): NotebookSession {
  const { notebookId } = options;
  const clock = options.clock ?? (() => performance.now());
  const autosaveMs = options.autosaveMs ?? NOTEBOOK_AUTOSAVE_MS;
  let ports = options.ports;
  /** Held from the start of a save-then-run or run until it settles, between store updates. */
  let lock: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const revealers = new Set<(cellId: string) => void>();

  const store = createStore<NotebookSessionState>(() => ({
    saved: options.saved ?? null,
    draft: null,
    outputs: {},
    durations: {},
    running: null,
    saving: 0,
    kernel: null,
    saveError: null,
    runError: null,
  }));

  const connected = () => {
    if (!ports) throw new Error("笔记本还没有连上服务端");
    return ports;
  };
  const doc = () => {
    const state = store.getState();
    return state.draft ?? state.saved;
  };

  const cancelAutosave = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  async function save(snapshot: NotebookDoc): Promise<NotebookDoc> {
    const key = notebookDraftKey(snapshot);
    store.setState((s) => ({ saving: s.saving + 1, saveError: null }));
    try {
      const saved = await connected().save(snapshot);
      // Edits made while saving stay in the draft for the next autosave.
      store.setState((s) => ({
        saved,
        draft: s.draft && notebookDraftKey(s.draft) !== key ? s.draft : null,
      }));
      return saved;
    } catch (err) {
      store.setState({ saveError: message(err) });
      throw err;
    } finally {
      store.setState((s) => ({ saving: s.saving - 1 }));
    }
  }

  const scheduleAutosave = () => {
    cancelAutosave();
    timer = setTimeout(() => {
      timer = undefined;
      const draft = store.getState().draft;
      if (draft) save(draft).catch(() => {});
    }, autosaveMs);
  };

  const recordRun = (result: NotebookRunResult, cellId: string | undefined, started: number) => {
    const elapsed = clock() - started;
    store.setState((s) => {
      const outputs: Record<string, CellRunResult> = cellId ? { ...s.outputs } : {};
      for (const cell of result.cells) outputs[cell.id] = cell;
      return {
        kernel: result.kernel ?? null,
        outputs,
        durations: cellId ? { ...s.durations, [cellId]: elapsed } : {},
      };
    });
  };

  async function run(cellId: string | undefined): Promise<NotebookRunResult> {
    const started = clock();
    store.setState({ runError: null });
    try {
      const result = await connected().run({ id: notebookId, ...(cellId && { cellId }) });
      recordRun(result, cellId, started);
      return result;
    } catch (err) {
      store.setState({ runError: message(err) });
      throw err;
    }
  }

  async function saveThenRun(cellId: string | null): Promise<NotebookRunResult | undefined> {
    lock = cellId ?? "save";
    if (cellId) store.setState({ running: cellId });
    try {
      const state = store.getState();
      if (state.draft) {
        cancelAutosave();
        await save(state.draft);
      }
      if (!cellId) return undefined;
      return await run(cellId);
    } finally {
      lock = null;
      store.setState({ running: null });
    }
  }

  const update = (patch: Partial<NotebookDoc>) => {
    const base = doc();
    if (!base) return;
    store.setState({ draft: { ...base, ...patch } });
    scheduleAutosave();
  };

  return {
    notebookId,
    store,
    doc,
    read() {
      const current = doc();
      if (!current) throw new Error("笔记本还在加载");
      return { doc: current, outputs: store.getState().outputs, busy: lock !== null };
    },
    isBusy: () => lock !== null,
    setSaved(next) {
      if (store.getState().saved !== next) store.setState({ saved: next });
    },
    connect(next) {
      ports = next;
    },
    update,
    setCells(cells, select) {
      update({ cells });
      if (select) for (const listener of revealers) listener(select);
    },
    onReveal(listener) {
      revealers.add(listener);
      return () => revealers.delete(listener);
    },
    clearOutput(cellId) {
      if (!cellId) {
        store.setState({ outputs: {}, durations: {} });
        return;
      }
      store.setState((s) => ({ outputs: omit(s.outputs, cellId), durations: omit(s.durations, cellId) }));
    },
    runAll() {
      if (lock) return;
      lock = "all";
      store.setState({ running: "all" });
      run(undefined)
        .catch(() => {})
        .finally(() => {
          lock = null;
          store.setState({ running: null });
        });
    },
    saveThenRun(cellId) {
      if (lock) return Promise.resolve(undefined);
      return saveThenRun(cellId);
    },
    async runCell(cellId) {
      if (lock) throw new Error("笔记本正在运行，等它结束再试");
      const result = await saveThenRun(cellId);
      if (!result) throw new Error("单元格没有运行");
      return result;
    },
    async flush() {
      const draft = store.getState().draft;
      if (!draft) return;
      cancelAutosave();
      await save(draft);
    },
    dispose: cancelAutosave,
  };
}
