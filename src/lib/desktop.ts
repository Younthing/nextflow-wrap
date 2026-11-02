/**
 * What the Electron preload script exposes as `window.studioDesktop`. In a plain browser it is absent and every
 * helper here falls back to what the web page can do on its own.
 */
export interface PickPathOptions {
  kind: "file" | "directory";
  title?: string;
  /** Start in this folder or next to this file. */
  defaultPath?: string;
  /** File name extensions without dots, e.g. `["h5ad", "loom"]`. */
  extensions?: string[];
  multiple?: boolean;
}

export interface DesktopNotification { title: string; body: string; runId?: string }

/** What the File menu lists. The page sends it whenever the project list changes. */
export interface ProjectMenuState {
  current?: { id: string; name: string; path: string };
  /** Most recently opened first. */
  recent: { id: string; name: string; path: string }[];
}

/** A native menu command the page carries out, so it runs through the same code as the in-page buttons. */
export type DesktopMenuAction =
  | { type: "new-project" }
  | { type: "open-folder" }
  | { type: "open-project"; id: string }
  | { type: "close-project" }
  | { type: "toggle-panel"; panel: "nav" | "explorer" };

export interface StudioDesktop {
  version: string;
  platform: string;
  /** Native open dialog. Resolves to absolute paths, empty when cancelled. */
  pickPath: (options: PickPathOptions) => Promise<string[]>;
  /** Absolute path of a file dragged in from Finder or a file manager. */
  pathForFile: (file: File) => string | undefined;
  showItemInFolder: (path: string) => Promise<void>;
  openPath: (path: string) => Promise<string>;
  notify: (notification: DesktopNotification) => void;
  /** Running-run count shown in the menu bar / tray and used by the quit prompt. */
  setActiveRuns: (count: number) => void;
  /** Fill the File menu's project items. Missing in shells older than the File menu. */
  setProjectMenu?: (state: ProjectMenuState) => void;
  /** Listen for File and View menu commands; returns the unsubscribe function. */
  onMenuAction?: (listener: (action: DesktopMenuAction) => void) => () => void;
}

declare global {
  interface Window { studioDesktop?: StudioDesktop }
}

export const desktop = (): StudioDesktop | undefined => (typeof window === "undefined" ? undefined : window.studioDesktop);
export const isDesktop = () => desktop() !== undefined;
