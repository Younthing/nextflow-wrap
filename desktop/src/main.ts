import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, type WriteStream } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, safeStorage, session, shell, Tray, utilityProcess, type MenuItemConstructorOptions, type UtilityProcess } from "electron";

import { ConnectionError, readConnection, type Connection } from "../../src/features/desktop/connections";
import { readProjectMenuState } from "../../src/features/desktop/project-menu";
import { SESSION_COOKIE } from "../../src/features/desktop/session-guard";
import { parseEnvBlock, quitPrompt, RestartTracker, SHELL_ENV_KEYS } from "../../src/features/desktop/supervisor";
import type { DesktopMenuAction, DesktopNotification, PickPathOptions, ProjectMenuState } from "../../src/lib/desktop";
import { freePort, installWsl, startBackend, waitForHealth, wslDistros, type BackendContext, type RunningBackend } from "./backends";
import { connectionToken, loadConnections, rememberLast, removeConnection, saveConnection } from "./connection-store";
import { setupUpdates } from "./updates";

/**
 * Nextflow Studio desktop: a shell around a server that may run here, in WSL or on another machine.
 *
 * - The server (web UI + `/api` + notebook kernels, and the Nextflow runner) comes from a saved connection
 *   (backends.ts). A local one is the Next.js standalone server and runner.mjs hosted here, on 127.0.0.1 at a
 *   random port, guarded by a per-launch session token (see src/proxy.ts), and restarted when they crash.
 * - Before a backend answers, the window shows the bundled connect page (connect/index.html).
 * - The shell owns the window, the menu bar / tray item and native dialogs, mapping paths for WSL.
 *
 * Nextflow heads run in their own process groups, so closing the app can leave them running ("后台继续"); the
 * next runner adopts them.
 */
const dev = process.argv.includes("--dev");
const resources = app.isPackaged ? process.resourcesPath : join(__dirname, "..", "resources");
let backend: RunningBackend | undefined;
/** Bumped on every start and stop of the local server, so its old processes are not restarted. */
let localGeneration = 0;
let connectError: string | undefined;
let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let activeRuns = 0;
let quitting = false;
let projectMenu: ProjectMenuState = { recent: [] };
const children = new Map<string, UtilityProcess>();

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

/**
 * The packaged app carries the Next.js server as `app-server.tar.gz` and unpacks it once per app version into
 * userData (a development build uses resources/app-server directly). Unpacking goes to a temporary folder that
 * is renamed into place, so an interrupted first start never leaves a half-extracted server behind.
 */
async function appServerDirectory(): Promise<string> {
  const archive = join(resources, "app-server.tar.gz");
  // Unpackaged runs keep the same app version across rebuilds, so a cached copy would serve a stale build.
  if (!app.isPackaged || !existsSync(archive)) return join(resources, "app-server");
  const root = join(app.getPath("userData"), "app-server");
  const target = join(root, app.getVersion());
  if (existsSync(join(target, "app-server", "server.js"))) return join(target, "app-server");
  const temporary = `${target}.${process.pid}.tmp`;
  rmSync(temporary, { recursive: true, force: true });
  mkdirSync(temporary, { recursive: true });
  await new Promise<void>((resolve, reject) => execFile("tar", ["-xzf", archive, "-C", temporary], (error) => (error ? reject(error) : resolve())));
  rmSync(target, { recursive: true, force: true });
  renameSync(temporary, target);
  // Older versions' copies are no longer needed.
  for (const name of readdirSync(root)) if (name !== app.getVersion()) rmSync(join(root, name), { recursive: true, force: true });
  return join(target, "app-server");
}

/** Start a hosted process and keep it alive: crash → backoff restart, too many → tell the user. */
function supervise(name: string, modulePath: string, args: string[], env: NodeJS.ProcessEnv, cwd?: string, keepTrying = false) {
  const generation = localGeneration;
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
      if (children.get(name) === child) children.delete(name);
      // Quitting, or this local server was stopped (another backend was picked): no restart.
      if (quitting || generation !== localGeneration) return;
      const delay = restarts.crash(Date.now());
      if (delay !== undefined) { setTimeout(start, delay); return; }
      // The runner fails until Java and Nextflow exist; the setup page installs them, so keep checking.
      if (keepTrying) { restarts.healthy(); setTimeout(start, 30_000); return; }
      dialog.showErrorBox(`Nextflow Studio：${name} 反复退出`, `最后一次退出码 ${code}。请在设置页导出诊断包，或重启应用。`);
    });
  };
  start();
}

/** The bundled server and runner on this computer: the original desktop setup, now one kind of backend. */
async function startLocal(context: BackendContext) {
  localGeneration++;
  const token = randomBytes(32).toString("hex");
  const secret = keychainSecret();
  if (secret) baseEnv = { ...baseEnv, NEXTFLOW_STUDIO_SECRET_KEY: secret };
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  context.status("启动本机服务端…");
  const serverDir = await appServerDirectory();
  const env = serviceEnv({ PORT: String(port), HOSTNAME: "127.0.0.1", NEXTFLOW_STUDIO_SESSION_TOKEN: token });
  supervise("web", join(serverDir, "server.js"), [], env, serverDir);
  supervise("runner", join(resources, "runner", "runner.mjs"), [], serviceEnv(), join(resources, "runner"), true);
  await waitForHealth(origin, token);
  return {
    origin,
    token,
    // SIGTERM lets the runner leave started Nextflow heads running and the web server shut kernels down.
    stop: async () => {
      localGeneration++;
      const running = [...children.values()];
      await Promise.all(running.map((child) => new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 15_000);
        child.once("exit", () => { clearTimeout(timer); resolve(); });
        child.kill();
      })));
    },
  };
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  if (!backend) throw new Error("没有连接后端");
  const response = await fetch(`${backend.origin}/api${path}`, { ...init, headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${backend.token}`, origin: backend.origin, ...init?.headers } });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.status === 204 ? undefined as T : await response.json() as T;
}

const connectPage = () => join(__dirname, "connect", "index.html");
const fromConnectPage = (event: Electron.IpcMainInvokeEvent) => event.senderFrame?.url.startsWith("file:") === true;

function createWindow() {
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
  const inApp = (url: string) => Boolean(backend && (url === backend.origin || url.startsWith(`${backend.origin}/`)));
  // Links to other sites open in the default browser; the window stays on the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!inApp(url)) void shell.openExternal(url);
    return { action: inApp(url) ? "allow" : "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!inApp(url)) { event.preventDefault(); void shell.openExternal(url); }
  });
  // Closing the window with runs going keeps the app in the menu bar so notifications still arrive.
  mainWindow.on("close", (event) => {
    if (quitting || activeRuns === 0) return;
    event.preventDefault();
    mainWindow?.hide();
  });
  mainWindow.on("closed", () => { mainWindow = undefined; });
  return mainWindow;
}

/** Shows a page of the connected server, or the connect page when there is none. */
function openApp(path = "/") {
  const window = mainWindow ?? createWindow();
  if (backend) void window.loadURL(`${backend.origin}${path}`);
  else void window.loadFile(connectPage());
  window.show();
  window.focus();
}

/** The connect page; `auto` connects to that saved connection right away. */
function showConnect(auto?: string) {
  const window = mainWindow ?? createWindow();
  void window.loadFile(connectPage(), auto ? { query: { auto } } : undefined);
  window.show();
}

function showWindow() {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  else openApp();
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
    { label: "运行记录", enabled: Boolean(backend), click: () => openApp("/runs") },
    { type: "separator" },
    { label: "退出", click: () => app.quit() },
  ]));
}

/** Menu commands run in the page, through the same code as its own buttons. */
function sendMenu(action: DesktopMenuAction) {
  showWindow();
  mainWindow?.webContents.send("studio:menu", action);
}

/**
 * The application menu. File holds the project: which one is open, new / open folder / recent, reveal and close.
 * Rebuilt whenever the page reports a change to the project list.
 */
function buildAppMenu() {
  const mac = process.platform === "darwin";
  const { current, recent } = projectMenu;
  const file: MenuItemConstructorOptions[] = [
    { label: current ? `当前项目：${current.name}` : "没有打开的项目", enabled: false },
    ...(current ? [{ label: current.path, enabled: false }] : []),
    { type: "separator" },
    { label: "新建项目…", accelerator: "CmdOrCtrl+Shift+N", click: () => sendMenu({ type: "new-project" }) },
    { label: "打开目录…", accelerator: "CmdOrCtrl+O", click: () => sendMenu({ type: "open-folder" }) },
    {
      label: "最近的项目",
      submenu: recent.length
        ? recent.map((project) => ({
          label: project.name,
          sublabel: project.path,
          toolTip: project.path,
          type: "checkbox" as const,
          checked: project.id === current?.id,
          click: () => sendMenu({ type: "open-project", id: project.id }),
        }))
        : [{ label: "还没有项目", enabled: false }],
    },
    { type: "separator" },
    { label: mac ? "在 Finder 中显示" : "在文件管理器中显示", enabled: Boolean(current && backend?.paths.toLocal(current.path)), click: () => { const local = current && backend?.paths.toLocal(current.path); if (local && existsSync(local)) shell.showItemInFolder(local); } },
    { label: "关闭项目", enabled: Boolean(current), click: () => sendMenu({ type: "close-project" }) },
    { type: "separator" },
    { label: backend ? `切换后端…（当前：${backend.info.label}）` : "连接后端…", click: () => void switchBackend() },
    { type: "separator" },
    mac ? { role: "close", label: "关闭窗口" } : { role: "quit", label: "退出" },
  ];
  const template: MenuItemConstructorOptions[] = [
    ...(mac ? [{ role: "appMenu" as const }] : []),
    { label: "File", submenu: file },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { label: "切换导航栏", click: () => sendMenu({ type: "toggle-panel", panel: "nav" }) },
        // The page handles Ctrl/Cmd+B itself (also in a browser); the menu only shows the shortcut.
        { label: "切换资源栏", accelerator: "CmdOrCtrl+B", registerAccelerator: false, click: () => sendMenu({ type: "toggle-panel", panel: "explorer" }) },
        { type: "separator" },
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpc() {
  ipcMain.handle("studio:pick-path", async (_event, options: PickPathOptions) => {
    const paths = backend?.paths;
    if (!paths || !backend?.info.nativePaths) return [];
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: options.title,
      defaultPath: options.defaultPath ? paths.toLocal(options.defaultPath) : undefined,
      properties: [options.kind === "directory" ? "openDirectory" : "openFile", ...(options.multiple ? ["multiSelections" as const] : []), "showHiddenFiles"],
      filters: options.kind === "file" && options.extensions?.length ? [{ name: options.extensions.join(", "), extensions: options.extensions }, { name: "所有文件", extensions: ["*"] }] : undefined,
    });
    if (result.canceled) return [];
    const mapped = result.filePaths.map((path) => paths.toServer(path));
    // A Windows folder outside WSL's reach (a network share) has no path inside the distro.
    if (mapped.some((path) => path === undefined)) {
      void dialog.showMessageBox(mainWindow!, { type: "warning", message: "服务端无法访问这个位置", detail: result.filePaths.join("\n") });
    }
    return mapped.filter((path): path is string => Boolean(path));
  });
  ipcMain.handle("studio:show-item", (_event, path: string) => {
    const local = typeof path === "string" ? backend?.paths.toLocal(path) : undefined;
    if (local && existsSync(local)) shell.showItemInFolder(local);
  });
  ipcMain.handle("studio:open-path", (_event, path: string) => {
    const local = typeof path === "string" ? backend?.paths.toLocal(path) : undefined;
    return local ? shell.openPath(local) : "这台电脑上打不开这个路径";
  });
  ipcMain.on("studio:backend", (event) => {
    const connection = backend?.connection;
    event.returnValue = backend ? { ...backend.info, ...(connection?.kind === "wsl" ? { distro: connection.distro } : {}) } : null;
  });
  ipcMain.on("studio:notify", (_event, notification: DesktopNotification) => {
    if (!Notification.isSupported()) return;
    const native = new Notification({ title: notification.title, body: notification.body });
    native.on("click", () => openApp(notification.runId ? `/runs/${encodeURIComponent(notification.runId)}` : "/"));
    native.show();
  });
  ipcMain.on("studio:project-menu", (_event, state: unknown) => {
    projectMenu = readProjectMenuState(state);
    buildAppMenu();
  });
  ipcMain.on("studio:active-runs", (_event, count: number) => {
    activeRuns = Number.isInteger(count) && count >= 0 ? count : 0;
    updateTray();
  });

  // The connect page (bundled file) only.
  ipcMain.handle("connect:state", (event) => {
    if (!fromConnectPage(event)) return null;
    const auto = new URL(event.senderFrame!.url).searchParams.get("auto") ?? undefined;
    const error = connectError;
    connectError = undefined;
    return { ...loadConnections(), platform: process.platform, localAvailable: process.platform !== "win32", auto, error };
  });
  ipcMain.handle("connect:distros", (event) => (fromConnectPage(event) ? wslDistros() : []));
  ipcMain.handle("connect:install-wsl", (event) => (fromConnectPage(event) ? installWsl() : { ok: false, error: "不允许" }));
  ipcMain.handle("connect:remove", (event, id: unknown) => (fromConnectPage(event) && typeof id === "string" ? removeConnection(id) : loadConnections()));
  ipcMain.handle("connect:start", async (event, input: unknown, token: unknown) => {
    if (!fromConnectPage(event)) return { ok: false, error: "不允许" };
    try {
      const connection = readConnection(input);
      await connect(connection, typeof token === "string" && token ? token : undefined);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

const context = (): BackendContext => ({
  appVersion: app.getVersion(),
  serverPackages: join(resources, "server"),
  log: serviceLog,
  status: (message) => mainWindow?.webContents.send("connect:status", message),
});

/** Starts or reaches the server of `connection`, then shows the app in the window. */
async function connect(connection: Connection, token?: string) {
  if (backend) await disconnect();
  const next = await startBackend(connection, context(), { token: token ?? connectionToken(connection.id), startLocal });
  await session.defaultSession.cookies.set({ url: next.origin, name: SESSION_COOKIE, value: next.token, httpOnly: true, sameSite: "strict", secure: next.origin.startsWith("https:") });
  backend = next;
  saveConnection(connection, connection.kind === "url" ? token : undefined);
  rememberLast(connection.id);
  next.onLost((reason) => {
    if (backend !== next) return;
    backend = undefined;
    connectError = reason;
    buildAppMenu();
    updateTray();
    showConnect();
  });
  buildAppMenu();
  updateTray();
  // A machine without Java or Nextflow starts on the setup page.
  const setup = await api<{ ready: boolean }>("/setup").catch(() => ({ ready: true }));
  openApp(setup.ready ? "/" : "/setup");
}

async function disconnect() {
  const current = backend;
  if (!current) return;
  backend = undefined;
  activeRuns = 0;
  await current.stop();
  buildAppMenu();
  updateTray();
}

async function switchBackend() {
  if (backend && !(await confirmStop())) return;
  await disconnect();
  showConnect();
}

/** Before stopping a server that holds active runs (local, WSL): keep them going or cancel them. */
async function confirmStop(): Promise<boolean> {
  if (!backend?.stopsWithApp) return true;
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
  void confirmStop().then(async (ok) => {
    if (!ok) return;
    quitting = true;
    // A local or WSL server stops (runs keep going); a remote one keeps running and only the tunnel closes.
    await disconnect().catch(() => undefined);
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
  baseEnv = { ...process.env, ...(await shellEnvironment()) };
  registerIpc();
  buildAppMenu();
  updateTray();
  if (!dev) setupUpdates();
  const store = loadConnections();
  const last = store.connections.find((item) => item.id === store.last);
  if (last) { showConnect(last.id); return; }
  // First start on macOS and Linux: the bundled server, as before. Windows has no local server: pick one.
  if (process.platform !== "win32" && !store.connections.length) {
    const local: Connection = { id: "local", kind: "local", label: "本机" };
    try { await connect(local); return; }
    catch (error) { connectError = error instanceof Error ? error.message : String(error); }
  }
  showConnect();
}).catch((error: unknown) => {
  dialog.showErrorBox("Nextflow Studio 无法启动", error instanceof ConnectionError || error instanceof Error ? error.message : String(error));
  app.exit(1);
});
