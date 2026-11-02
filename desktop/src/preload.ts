import { contextBridge, ipcRenderer, webUtils } from "electron";

import { windowsToWsl } from "../../src/features/desktop/backend-paths";
import type { DesktopBackend, DesktopMenuAction, DesktopNotification, PickPathOptions, ProjectMenuState, StudioDesktop } from "../../src/lib/desktop";

/**
 * Two pages load in the window. The bundled connect page (file:) gets `studioConnect` to pick a backend; the
 * server's pages get `studioDesktop`: dialogs, paths of dropped files, Finder, notifications, run count, and the
 * File menu's project items and commands.
 */
if (location.protocol === "file:") {
  contextBridge.exposeInMainWorld("studioConnect", {
    state: () => ipcRenderer.invoke("connect:state"),
    distros: () => ipcRenderer.invoke("connect:distros"),
    installWsl: () => ipcRenderer.invoke("connect:install-wsl"),
    connect: (connection: unknown, token?: string) => ipcRenderer.invoke("connect:start", connection, token),
    remove: (id: string) => ipcRenderer.invoke("connect:remove", id),
    onStatus: (listener: (message: string) => void) => { ipcRenderer.on("connect:status", (_event, message: string) => listener(message)); },
  });
} else {
  // Asked once per page load; switching backends reloads the window.
  const backend = ipcRenderer.sendSync("studio:backend") as (DesktopBackend & { distro?: string }) | null;
  const toServer = (path: string) => {
    if (!backend || !backend.nativePaths) return undefined;
    return backend.kind === "wsl" && backend.distro ? windowsToWsl(path, backend.distro) : path;
  };
  const bridge: StudioDesktop = {
    version: process.env.npm_package_version ?? "",
    platform: process.platform,
    ...(backend ? { backend: { kind: backend.kind, label: backend.label, nativePaths: backend.nativePaths } } : {}),
    pickPath: (options: PickPathOptions) => ipcRenderer.invoke("studio:pick-path", options),
    pathForFile: (file: File) => {
      try { return toServer(webUtils.getPathForFile(file)) || undefined; }
      catch { return undefined; }
    },
    showItemInFolder: (path: string) => ipcRenderer.invoke("studio:show-item", path),
    openPath: (path: string) => ipcRenderer.invoke("studio:open-path", path),
    notify: (notification: DesktopNotification) => ipcRenderer.send("studio:notify", notification),
    setActiveRuns: (count: number) => ipcRenderer.send("studio:active-runs", count),
    setProjectMenu: (state: ProjectMenuState) => ipcRenderer.send("studio:project-menu", state),
    onMenuAction: (listener: (action: DesktopMenuAction) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, action: DesktopMenuAction) => listener(action);
      ipcRenderer.on("studio:menu", handler);
      return () => { ipcRenderer.removeListener("studio:menu", handler); };
    },
  };
  contextBridge.exposeInMainWorld("studioDesktop", bridge);
}
