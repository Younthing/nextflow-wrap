import { contextBridge, ipcRenderer, webUtils } from "electron";

import type { DesktopNotification, PickPathOptions, StudioDesktop } from "../../src/lib/desktop";

/** The only native surface the web UI gets: dialogs, paths of dropped files, Finder, notifications, run count. */
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
};

contextBridge.exposeInMainWorld("studioDesktop", bridge);
