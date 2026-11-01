import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync, type WriteStream } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, safeStorage, session, shell, Tray, utilityProcess, type UtilityProcess } from "electron";

import { SESSION_COOKIE } from "../../src/features/desktop/session-guard";
import { parseEnvBlock, quitPrompt, RestartTracker, SHELL_ENV_KEYS } from "../../src/features/desktop/supervisor";
import type { DesktopNotification, PickPathOptions } from "../../src/lib/desktop";
import { setupUpdates } from "./updates";

/**
 * Nextflow Studio desktop: the main process hosts three things and restarts them when they crash.
 *
 * - the Next.js standalone server (web UI + `/api`, which also owns the notebook Jupyter kernels), on 127.0.0.1 at
 *   a random port, guarded by a per-launch session token (see src/proxy.ts);
 * - the Nextflow runner (scripts/runner.ts bundled to runner.mjs), which queues and supervises runs;
 * - the window, the menu bar / tray item and native dialogs.
 *
 * Nextflow heads run in their own process groups, so closing the app can leave them running ("后台继续"); the
 * next runner adopts them.
 */
const dev = process.argv.includes("--dev");
const resources = app.isPackaged ? process.resourcesPath : join(__dirname, "..", "resources");
const token = randomBytes(32).toString("hex");
let port = 0;
let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let activeRuns = 0;
let quitting = false;
const children = new Map<string, UtilityProcess>();

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => (typeof address === "object" && address ? resolve(address.port) : reject(new Error("no port"))));
    });
  });
}

/** GUI apps on macOS do not inherit the shell PATH; ask the login shell once at start. */
async function shellEnvironment(): Promise<Record<string, string>> {
  if (process.platform !== "darwin" && process.env.PATH?.includes("/usr/local/bin")) return {};
  const shellPath = process.env.SHELL || "/bin/zsh";
  return new Promise((resolve) => {
    execFile(shellPath, ["-ilc", "env -0"], { timeout: 5_000, maxBuffer: 1024 ** 2 }, (error, stdout) => {
      if (error) { resolve({}); return; }
      const parsed = parseEnvBlock(stdout);
      resolve(Object.fromEntries(SHELL_ENV_KEYS.filter((key) => parsed[key]).map((key) => [key, parsed[key]!])));
    });
  });
}

let baseEnv: NodeJS.ProcessEnv = process.env;

/**
 * Key for the API keys saved on the settings page. It is random per install and stored encrypted with
 * safeStorage (macOS Keychain, libsecret / kwallet on Linux). Linux without a keyring falls back to a plain
 * 0600 secrets file in the data directory.
 */
function keychainSecret(): string | undefined {
  if (!safeStorage.isEncryptionAvailable()) return undefined;
  if (process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text") return undefined;
  const file = join(app.getPath("userData"), "secret-key.bin");
  try { return safeStorage.decryptString(readFileSync(file)); }
  catch { /* First start, or the keychain entry changed: make a new key. */ }
  const key = randomBytes(32).toString("hex");
  writeFileSync(file, safeStorage.encryptString(key), { mode: 0o600 });
  return key;
}

function serviceEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    NEXTFLOW_STUDIO_DESKTOP: "1",
    NEXTFLOW_STUDIO_APP_VERSION: app.getVersion(),
    NEXTFLOW_STUDIO_BUNDLED_PLUGINS: join(resources, "plugins"),
    NEXTFLOW_STUDIO_LOG_DIR: app.getPath("logs"),
    NEXT_PUBLIC_API_MOCKING: "disabled",
    NODE_ENV: "production",
    ...extra,
  };
}

/** `<logs>/<name>.log`, the previous launch kept as `<name>.1.log`. The diagnostics bundle collects both. */
function serviceLog(name: string): WriteStream {
  const dir = app.getPath("logs");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.log`);
  try { if (statSync(file).size > 0) renameSync(file, join(dir, `${name}.1.log`)); } catch { /* First launch. */ }
  return createWriteStream(file, { flags: "a" });
}

/** Start a hosted process and keep it alive: crash → backoff restart, too many → tell the user. */
function supervise(name: string, modulePath: string, args: string[], env: NodeJS.ProcessEnv, cwd?: string) {
  const restarts = new RestartTracker();
  const log = serviceLog(name);
  const start = () => {
    log.write(`--- ${new Date().toISOString()} start ${name} ${app.getVersion()}\n`);
    const child = utilityProcess.fork(modulePath, args, { env, cwd, stdio: "pipe", serviceName: `Nextflow Studio ${name}` });
    children.set(name, child);
    child.stdout?.on("data", (chunk: Buffer) => { log.write(chunk); if (dev) process.stdout.write(`[${name}] ${chunk}`); });
    child.stderr?.on("data", (chunk: Buffer) => { log.write(chunk); if (dev) process.stderr.write(`[${name}] ${chunk}`); });
    const healthyTimer = setTimeout(() => restarts.healthy(), 60_000);
    child.once("exit", (code) => {
      log.write(`--- ${new Date().toISOString()} ${name} exited with ${code}\n`);
      clearTimeout(healthyTimer);
      children.delete(name);
      if (quitting) return;
      const delay = restarts.crash(Date.now());
      if (delay === undefined) {
        dialog.showErrorBox(`Nextflow Studio：${name} 反复退出`, `最后一次退出码 ${code}。请在设置页导出诊断包，或重启应用。`);
        return;
      }
      setTimeout(start, delay);
    });
  };
  start();
}

async function waitForServer(url: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/health`, { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
      if (response.ok) return;
    } catch { /* Not listening yet. */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Web 服务没有在 60 秒内启动");
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${port}/api${path}`, { ...init, headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${token}`, origin: `http://127.0.0.1:${port}`, ...init?.headers } });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.status === 204 ? undefined as T : await response.json() as T;
}

function createWindow(path: string) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: "Nextflow Studio",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    backgroundColor: "#0b1020",
    webPreferences: { preload: join(__dirname, "preload.js"), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  const origin = `http://127.0.0.1:${port}`;
  // Links to other sites open in the default browser; the window stays on the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(origin)) void shell.openExternal(url);
    return { action: url.startsWith(origin) ? "allow" : "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(origin)) { event.preventDefault(); void shell.openExternal(url); }
  });
  // Closing the window with runs going keeps the app in the menu bar so notifications still arrive.
  mainWindow.on("close", (event) => {
    if (quitting || activeRuns === 0) return;
    event.preventDefault();
    mainWindow?.hide();
  });
  mainWindow.on("closed", () => { mainWindow = undefined; });
  void mainWindow.loadURL(`${origin}${path}`);
}

function showWindow() {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  else createWindow("/workflows");
}

function updateTray() {
  if (!tray) {
    const icon = nativeImage.createFromPath(join(resources, "trayTemplate.png"));
    tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
    tray.on("click", showWindow);
  }
  tray.setToolTip(activeRuns ? `Nextflow Studio：${activeRuns} 个运行中` : "Nextflow Studio");
  if (process.platform === "darwin") tray.setTitle(activeRuns ? `${activeRuns}` : "");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: activeRuns ? `${activeRuns} 个运行中` : "没有运行中的流程", enabled: false },
    { label: "打开 Nextflow Studio", click: showWindow },
    { label: "运行记录", click: () => { showWindow(); void mainWindow?.loadURL(`http://127.0.0.1:${port}/runs`); } },
    { type: "separator" },
    { label: "退出", click: () => app.quit() },
  ]));
}

function registerIpc() {
  ipcMain.handle("studio:pick-path", async (_event, options: PickPathOptions) => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: options.title,
      defaultPath: options.defaultPath,
      properties: [options.kind === "directory" ? "openDirectory" : "openFile", ...(options.multiple ? ["multiSelections" as const] : []), "showHiddenFiles"],
      filters: options.kind === "file" && options.extensions?.length ? [{ name: options.extensions.join(", "), extensions: options.extensions }, { name: "所有文件", extensions: ["*"] }] : undefined,
    });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle("studio:show-item", (_event, path: string) => { if (typeof path === "string" && existsSync(path)) shell.showItemInFolder(path); });
  ipcMain.handle("studio:open-path", (_event, path: string) => (typeof path === "string" ? shell.openPath(path) : "无效路径"));
  ipcMain.on("studio:notify", (_event, notification: DesktopNotification) => {
    if (!Notification.isSupported()) return;
    const native = new Notification({ title: notification.title, body: notification.body });
    native.on("click", () => {
      showWindow();
      if (notification.runId) void mainWindow?.loadURL(`http://127.0.0.1:${port}/runs/${encodeURIComponent(notification.runId)}`);
    });
    native.show();
  });
  ipcMain.on("studio:active-runs", (_event, count: number) => {
    activeRuns = Number.isInteger(count) && count >= 0 ? count : 0;
    updateTray();
  });
}

/** Ask what to do with active runs, then stop the hosted processes. */
async function confirmQuit(): Promise<boolean> {
  const prompt = quitPrompt(activeRuns);
  if (!prompt.needed) return true;
  const { response } = await dialog.showMessageBox({ type: "question", message: prompt.message, detail: prompt.detail, buttons: prompt.buttons.map((b) => b.label), defaultId: 0, cancelId: 2 });
  const choice = prompt.buttons[response]?.choice ?? "cancel";
  if (choice === "cancel") return false;
  if (choice === "stop") {
    const runs = await api<{ id: string; status: string }[]>("/runs").catch(() => []);
    await Promise.all(runs.filter((run) => run.status === "running" || run.status === "submitted").map((run) => api(`/runs/${run.id}/cancel`, { method: "POST" }).catch(() => undefined)));
    // The runner signals each head and waits for it; give it a moment before the runner itself stops.
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const left = await api<{ status: string }[]>("/runs").then((list) => list.filter((run) => run.status === "running" || run.status === "submitted").length).catch(() => 0);
      if (!left) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return true;
}

app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  void confirmQuit().then((ok) => {
    if (!ok) return;
    quitting = true;
    // SIGTERM lets the runner leave started Nextflow heads running and the web server shut kernels down.
    for (const child of children.values()) child.kill();
    app.quit();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && activeRuns === 0) app.quit();
});
app.on("activate", showWindow);

if (!app.requestSingleInstanceLock()) app.quit();
else app.on("second-instance", showWindow);

app.whenReady().then(async () => {
  const secret = keychainSecret();
  baseEnv = { ...process.env, ...(await shellEnvironment()), ...(secret ? { NEXTFLOW_STUDIO_SECRET_KEY: secret } : {}) };
  port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  await session.defaultSession.cookies.set({ url: origin, name: SESSION_COOKIE, value: token, httpOnly: true, sameSite: "strict" });
  registerIpc();
  const serverDir = join(resources, "app-server");
  const env = serviceEnv({ PORT: String(port), HOSTNAME: "127.0.0.1", NEXTFLOW_STUDIO_SESSION_TOKEN: token });
  supervise("web", join(serverDir, "server.js"), [], env, serverDir);
  supervise("runner", join(resources, "runner", "runner.mjs"), [], serviceEnv(), join(resources, "runner"));
  await waitForServer(origin);
  // A machine without Java or Nextflow starts on the setup page.
  const setup = await api<{ ready: boolean }>("/setup").catch(() => ({ ready: true }));
  createWindow(setup.ready ? "/workflows" : "/setup");
  updateTray();
  if (!dev) setupUpdates();
}).catch((error: unknown) => {
  dialog.showErrorBox("Nextflow Studio 无法启动", error instanceof Error ? error.message : String(error));
  app.exit(1);
});
