export interface FsEntry { name: string; path: string; kind: "file" | "directory"; size?: number }
export interface FsListing { path: string; parent?: string; entries: FsEntry[]; home: string }

/** What a server path picker asks for. */
export interface PickOptions {
  kind: "file" | "directory";
  title?: string;
  /** Start in this folder or next to this file. */
  defaultPath?: string;
  /** File name extensions without dots, e.g. `["h5ad", "loom"]`. */
  extensions?: string[];
  /** Browse only inside this folder (the workspace, for data inputs). */
  root?: string;
}
