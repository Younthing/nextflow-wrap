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
}

declare global {
  interface Window { studioDesktop?: StudioDesktop }
}

export const desktop = (): StudioDesktop | undefined => (typeof window === "undefined" ? undefined : window.studioDesktop);
export const isDesktop = () => desktop() !== undefined;
