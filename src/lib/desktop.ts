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

/**
 * What the Electron preload script exposes as `window.studioDesktop`: the parts of the app that belong to the
 * desktop window itself (menu, notifications, menu bar run count). Files never go through it: the server owns them,
 * pickers browse the server and dropped files are uploaded, the same in a browser and in every kind of backend.
 */
export interface StudioDesktop {
  version: string;
  platform: string;
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

