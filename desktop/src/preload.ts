import { contextBridge, ipcRenderer, webUtils } from "electron";

import type { DesktopMenuAction, DesktopNotification, PickPathOptions, ProjectMenuState, StudioDesktop } from "../../src/lib/desktop";

/**
 * The only native surface the web UI gets: dialogs, paths of dropped files, Finder, notifications, run count,
 * and the File menu's project items and commands.
 */
const bridge: StudioDesktop = {
  version: process.env.npm_package_version ?? "",
  platform: process.platform,
  pickPath: (options: PickPathOptions) => ipcRenderer.invoke("studio:pick-path", options),
  pathForFile: (file: File) => {
    try { return webUtils.getPathForFile(file) || undefined; }
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
