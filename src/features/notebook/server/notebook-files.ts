import { randomUUID } from "node:crypto";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import { IpynbError, notebookFromIpynb, serializeIpynb, type IpynbNotebook } from "@/features/notebook/ipynb";
import type { NotebookDoc } from "@/features/notebook/types";
import { ensureWorkspace, writeFileAtomic } from "@/features/workspace/server/workspace";
import type { StudioStore } from "@/lib/server/database";

/**
 * Keeps `notebooks/*.ipynb` in a workspace and the notebook rows in the database in step.
 *
 * The file is what the user owns: Jupyter, an editor or `git pull` may change it. The database keeps the
 * revision history, try-run receipts and published modules that point at notebook revisions.
 * - Before a notebook is read, a file that changed on disk is imported; content changes become a new revision.
 * - A save writes the file. If the file changed on disk since the app last saw it, the save is refused
 *   with a conflict instead of overwriting the other edit.
 * - A file without app metadata (dropped in, or made in Jupyter) becomes a new notebook.
 * - A notebook whose file is missing is written again; deleting notebooks is not supported yet.
 */
export class NotebookConflictError extends Error {}

interface Entry {
  file: string;
  mtimeMs: number;
  size: number;
  /** Notebook content as last read from or written to the file. */
  content: string;
}

const FOLDER = "notebooks";
const UNSAFE = /[\\/:*?"<>|\u0000-\u001f]/g;

/** The part of a notebook its file holds. Two notebooks with the same key need no sync. */
function contentKey(doc: IpynbNotebook): string {
  return JSON.stringify([doc.name, doc.description, doc.kernel, doc.language, doc.cells]);
}

function baseName(name: string, id: string): string {
  const clean = name.replace(UNSAFE, "-").replace(/\s+/g, " ").trim().replace(/^\.+/, "").slice(0, 80).trim();
  return clean || id;
}

export class NotebookFiles {
  readonly folder: string;
  private readonly entries = new Map<string, Entry>();

  constructor(readonly root: string) {
    this.folder = join(root, FOLDER);
  }

  /** Path of a notebook's file relative to the workspace, for display. */
  pathOf(id: string): string | undefined {
    const entry = this.entries.get(id);
    return entry ? `${FOLDER}/${entry.file}` : undefined;
  }

  private chooseFile(doc: NotebookDoc): string {
    const current = this.entries.get(doc.id)?.file;
    const base = baseName(doc.name, doc.id);
    if (current && current.slice(0, -".ipynb".length).replace(/ \(nb_[\w-]+\)$/, "") === base) return current;
    const taken = new Set([...this.entries].filter(([id]) => id !== doc.id).map(([, entry]) => entry.file.toLowerCase()));
    // Case-insensitive file systems (macOS, Windows) treat `QC.ipynb` and `qc.ipynb` as one file.
    const plain = `${base}.ipynb`;
    return taken.has(plain.toLowerCase()) ? `${base} (${doc.id}).ipynb` : plain;
  }

  private async readFile(file: string) {
    const path = join(this.folder, file);
    const [text, info] = await Promise.all([readFile(path, "utf8"), stat(path)]);
    return { text, mtimeMs: info.mtimeMs, size: info.size };
  }

  /** Write one notebook's file and remember what was written. Refuses to overwrite an edit made on disk. */
  async write(doc: NotebookDoc): Promise<void> {
    const entry = this.entries.get(doc.id);
    if (entry) {
      const changed = await this.changedOnDisk(entry);
      if (changed && changed !== "missing" && contentKey(changed.doc) !== entry.content) {
        throw new NotebookConflictError(`${FOLDER}/${entry.file} 在应用外被修改过。重新打开笔记本载入磁盘上的版本后再保存`);
      }
    }
    const file = this.chooseFile(doc);
    const text = serializeIpynb(doc);
    await writeFileAtomic(join(this.folder, file), text);
    if (entry && entry.file !== file) await rm(join(this.folder, entry.file), { force: true });
    const info = await stat(join(this.folder, file));
    this.entries.set(doc.id, { file, mtimeMs: info.mtimeMs, size: info.size, content: contentKey(doc) });
  }

  /**
   * The file's notebook and stat when its size or time differ from the entry, `missing` when it is gone,
   * otherwise undefined. A file that does not parse (half saved, broken) counts as unchanged until it does.
   */
  private async changedOnDisk(entry: Entry): Promise<{ doc: IpynbNotebook; mtimeMs: number; size: number } | "missing" | undefined> {
    let info;
    try {
      info = await stat(join(this.folder, entry.file));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
      throw error;
    }
    if (info.mtimeMs === entry.mtimeMs && info.size === entry.size) return undefined;
    const { text, mtimeMs, size } = await this.readFile(entry.file);
    try {
      return { doc: notebookFromIpynb(text, entry.file.replace(/\.ipynb$/, "")), mtimeMs, size };
    } catch (error) {
      if (error instanceof IpynbError) return undefined;
      throw error;
    }
  }

  /** Import the given notebook's file (or every file) if it changed on disk since the last sync. */
  async refresh(db: StudioStore, id?: string): Promise<void> {
    let missing = false;
    for (const key of id ? [id] : [...this.entries.keys()]) {
      const entry = this.entries.get(key);
      const current = db.notebook(key);
      if (!entry || !current) continue;
      const changed = await this.changedOnDisk(entry);
      if (changed === "missing") {
        // Renamed or deleted outside the app; the folder scan below tells which.
        this.entries.delete(key);
        missing = true;
      } else if (changed) {
        if (contentKey(changed.doc) !== entry.content) entry.content = contentKey(db.saveNotebook({ ...current, ...changed.doc, id: key }));
        entry.mtimeMs = changed.mtimeMs;
        entry.size = changed.size;
      }
    }
    if (!id || missing) await this.reconcile(db);
  }

  /** Files that appeared since the last scan, for example copied in, renamed or made in Jupyter. */
  private async adoptNewFiles(db: StudioStore) {
    const known = new Set([...this.entries.values()].map((entry) => entry.file));
    const files = (await readdir(this.folder).catch(() => [] as string[])).filter((file) => file.endsWith(".ipynb") && !file.startsWith(".") && !known.has(file));
    for (const file of files.sort()) await this.adopt(db, file);
  }

  private async adopt(db: StudioStore, file: string) {
    let parsed: IpynbNotebook;
    let read;
    try {
      read = await this.readFile(file);
      parsed = notebookFromIpynb(read.text, file.replace(/\.ipynb$/, ""));
    } catch (error) {
      if (error instanceof IpynbError) {
        console.warn(`跳过无法读取的笔记本 ${FOLDER}/${file}：${error.message}`);
        return;
      }
      throw error;
    }
    // A file renamed outside the app renames the notebook, so the next save keeps the user's file name.
    const fileBase = file.replace(/\.ipynb$/, "").replace(/ \(nb_[\w-]+\)$/, "");
    if (baseName(parsed.name, parsed.id ?? "") !== fileBase) parsed = { ...parsed, name: fileBase.slice(0, 80) };
    const claimed = parsed.id ? this.entries.has(parsed.id) : false;
    const existing = parsed.id && !claimed ? db.notebook(parsed.id) : undefined;
    if (existing) {
      // The database already has this notebook: the file wins.
      const saved = contentKey(parsed) === contentKey(existing) ? existing : db.saveNotebook({ ...existing, ...parsed, id: existing.id });
      this.entries.set(existing.id, { file, mtimeMs: read.mtimeMs, size: read.size, content: contentKey(saved) });
      return;
    }
    // A new notebook, or a copy of another notebook's file: give it its own id and record it in the file.
    const now = new Date().toISOString();
    const id = parsed.id && !claimed ? parsed.id : `nb_${randomUUID().slice(0, 8)}`;
    const saved = db.saveNotebook({ ...parsed, id, rev: 1, createdAt: now, updatedAt: now });
    this.entries.set(id, { file, mtimeMs: read.mtimeMs, size: read.size, content: contentKey(saved) });
    if (parsed.id !== id) await this.write(saved);
  }

  /** Import files the app has not seen, then write files for notebooks that have none. */
  async reconcile(db: StudioStore): Promise<void> {
    await this.adoptNewFiles(db);
    // Oldest first, so the first notebook with a name gets the plain file name.
    const docs = db.notebooks().sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    for (const doc of docs) {
      if (!this.entries.has(doc.id)) await this.write(doc);
    }
  }
}

const opened = new WeakMap<StudioStore, Promise<NotebookFiles | undefined>>();

/** The workspace notebook files for a database, opened and reconciled once per process. */
export function notebookFiles(db: StudioStore): Promise<NotebookFiles | undefined> {
  if (!db.workspace) return Promise.resolve(undefined);
  let pending = opened.get(db);
  if (!pending) {
    const root = db.workspace;
    pending = (async () => {
      await ensureWorkspace(root);
      const files = new NotebookFiles(root);
      await files.reconcile(db);
      return files;
    })();
    pending.catch(() => opened.delete(db));
    opened.set(db, pending);
  }
  return pending;
}
