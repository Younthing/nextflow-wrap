import { app, dialog } from "electron";
import electronUpdater from "electron-updater";

/**
 * App updates come from GitHub Releases (electron-builder `publish: github`). The toolchain (JRE, Nextflow,
 * nf-weblog, micromamba) is versioned separately under the data directory and is not touched by an app update.
 * Set NEXTFLOW_STUDIO_DISABLE_UPDATES=1 to turn checks off (managed machines, offline sites).
 */
export function setupUpdates() {
  if (!app.isPackaged || process.env.NEXTFLOW_STUDIO_DISABLE_UPDATES === "1") return;
  const { autoUpdater } = electronUpdater;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("error", (error) => console.error("update:", error));
  autoUpdater.on("update-downloaded", async (info) => {
    const { response } = await dialog.showMessageBox({
      type: "info",
      message: `Nextflow Studio ${info.version} 已下载`,
      detail: "重启后生效。运行中的流程不受影响：它们在后台继续，重启后接着显示。",
      buttons: ["现在重启", "稍后"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });
  void autoUpdater.checkForUpdates().catch(() => undefined);
  setInterval(() => void autoUpdater.checkForUpdates().catch(() => undefined), 6 * 60 * 60 * 1000).unref();
}
