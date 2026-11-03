import { contextBridge, ipcRenderer } from "electron";

import type { DesktopBackendAction, DesktopBackendBridge, DesktopMenuAction, DesktopNotification, ProjectMenuState, StudioDesktop } from "../../src/lib/desktop";

/**
 * Two pages load in the window. The bundled start page (file:) gets `studioConnect`: the start-up screen while
 * the backend starts, and the recovery and connection forms when it does not. The server's pages get
 * `studioDesktop`: notifications, the run count, the File menu and managing the backend (welcome page). Files are
 * the server's business (pickers browse it, drops upload to it), so nothing about this computer's files crosses
 * the bridge.
 */
const appVersion = process.argv.find((arg) => arg.startsWith("--studio-version="))?.slice("--studio-version=".length) ?? "";

if (location.protocol === "file:") {
  contextBridge.exposeInMainWorld("studioConnect", {
    state: () => ipcRenderer.invoke("connect:state"),
    distros: () => ipcRenderer.invoke("connect:distros"),
    installWsl: () => ipcRenderer.invoke("connect:install-wsl"),
    connect: (connection: unknown, token?: string) => ipcRenderer.invoke("connect:start", connection, token),
    retry: (options?: { reinstall?: boolean }) => ipcRenderer.invoke("connect:retry", options ?? {}),
    remove: (id: string) => ipcRenderer.invoke("connect:remove", id),
    onStatus: (listener: (message: string) => void) => { ipcRenderer.on("connect:status", (_event, message: string) => listener(message)); },
  });
} else {
  const backend: DesktopBackendBridge = {
    info: () => ipcRenderer.invoke("backend:info"),
    run: (action: DesktopBackendAction) => ipcRenderer.invoke("backend:run", action),
    list: () => ipcRenderer.invoke("backend:list"),
    distros: () => ipcRenderer.invoke("backend:distros"),
    installWsl: () => ipcRenderer.invoke("backend:install-wsl"),
    connect: (connection, token) => ipcRenderer.invoke("backend:connect", connection, token),
    remove: (id: string) => ipcRenderer.invoke("backend:remove", id),
  };
  const bridge: StudioDesktop = {
    version: appVersion,
    platform: process.platform,
    notify: (notification: DesktopNotification) => ipcRenderer.send("studio:notify", notification),
    setActiveRuns: (count: number) => ipcRenderer.send("studio:active-runs", count),
    setProjectMenu: (state: ProjectMenuState) => ipcRenderer.send("studio:project-menu", state),
    onMenuAction: (listener: (action: DesktopMenuAction) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, action: DesktopMenuAction) => listener(action);
      ipcRenderer.on("studio:menu", handler);
      return () => { ipcRenderer.removeListener("studio:menu", handler); };
    },
    backend,
  };
  contextBridge.exposeInMainWorld("studioDesktop", bridge);
}
