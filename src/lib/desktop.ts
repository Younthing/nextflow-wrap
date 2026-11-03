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
  | { type: "toggle-panel"; panel: "nav" | "explorer" }
  | { type: "manage-backend" };

/** A saved backend, as the shell stores it (see src/features/desktop/connections.ts). */
export interface DesktopConnection {
  id: string;
  kind: "local" | "wsl" | "ssh" | "url";
  label: string;
  distro?: string;
  target?: string;
  port?: number;
  identityFile?: string;
  url?: string;
}

/** The backend the window is connected to. */
export interface DesktopBackendInfo {
  connection: DesktopConnection;
  /** Distro, ssh target or address. */
  detail: string;
  /** A development shell: "重新安装" rebuilds the server from the checkout first. */
  dev: boolean;
  platform: string;
  server: { version?: string; build?: string };
}

/** Restart, reinstall (rebuild in a development shell) or clear the data of the connected server. */
export type DesktopBackendAction = "restart" | "reinstall" | "clear-data";

export interface DesktopBackendList {
  connections: DesktopConnection[];
  currentId?: string;
  platform: string;
  localAvailable: boolean;
}

/**
 * Managing the backend from the welcome page. The shell carries the actions out: the window shows its start-up
 * screen while the server stops and starts, then loads the app again, so the promises of `run` and `connect` may
 * never settle in the page that called them.
 */
export interface DesktopBackendBridge {
  info: () => Promise<DesktopBackendInfo | null>;
  run: (action: DesktopBackendAction) => Promise<void>;
  list: () => Promise<DesktopBackendList>;
  distros: () => Promise<string[]>;
  installWsl: () => Promise<{ ok: boolean; error?: string }>;
  connect: (connection: Omit<DesktopConnection, "id" | "label"> & { id?: string; label?: string }, token?: string) => Promise<{ ok: boolean; error?: string }>;
  remove: (id: string) => Promise<DesktopBackendList>;
}

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
  /** Missing in shells older than backend management, and in a browser. */
  backend?: DesktopBackendBridge;
}

declare global {
  interface Window { studioDesktop?: StudioDesktop }
}

export const desktop = (): StudioDesktop | undefined => (typeof window === "undefined" ? undefined : window.studioDesktop);
export const isDesktop = () => desktop() !== undefined;

