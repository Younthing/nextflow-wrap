import { contextBridge, ipcRenderer } from "electron";

import type { DesktopMenuAction, DesktopNotification, ProjectMenuState, StudioDesktop } from "../../src/lib/desktop";

/**
 * Two pages load in the window. The bundled connect page (file:) gets `studioConnect` to pick a backend; the
 * server's pages get `studioDesktop`: notifications, the run count and the File menu. Files are the server's
 * business (pickers browse it, drops upload to it), so nothing about this computer's files crosses the bridge.
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
  const bridge: StudioDesktop = {
    version: process.env.npm_package_version ?? "",
    platform: process.platform,
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
