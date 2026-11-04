import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, type WriteStream } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, safeStorage, session, shell, Tray, utilityProcess, type MenuItemConstructorOptions, type UtilityProcess } from "electron";

import { connectionDetail, ConnectionError, DATA_ENTRIES, LOCAL_CONNECTION, readConnection, wslConnection, type Connection } from "../../src/features/desktop/connections";
import { readProjectMenuState } from "../../src/features/desktop/project-menu";
import { SESSION_COOKIE } from "../../src/features/desktop/session-guard";
import { parseEnvBlock, quitPrompt, RestartTracker, SHELL_ENV_KEYS } from "../../src/features/desktop/supervisor";
import { clearRouteCache } from "../../src/features/server/serve-config";
import { getProductTheme } from "../../src/lib/product-theme";
import { dataDirectory } from "../../src/lib/server/paths";
import { SCHEMA_VERSION } from "../../src/lib/server/schema";
import type { DesktopBackendAction, DesktopBackendInfo, DesktopMenuAction, DesktopNotification, ProjectMenuState } from "../../src/lib/desktop";
import { clearServerData, freePort, installWsl, runLogged, startBackend, stopServer, waitForHealth, wslDistros, type BackendContext, type RunningBackend } from "./backends";
import { connectionToken, loadConnections, rememberLast, removeConnection, saveConnection } from "./connection-store";
import { setupUpdates } from "./updates";

const productName = getProductTheme().displayName;

/**
 * Nextflow Studio desktop: a shell around a server that may run here, in WSL or on another machine.
 *
 * - The server (web UI + `/api` + notebook kernels, and the Nextflow runner) comes from a saved connection
 *   (backends.ts). A local one is the Next.js standalone server and runner.mjs hosted here, on 127.0.0.1 at a
 *   random port, guarded by a per-launch session token (see src/proxy.ts), and restarted when they crash.
 * - At start the window shows the bundled start page (connect/index.html) while the last backend (or the default:
 *   WSL on Windows, this computer elsewhere) starts, then the server's welcome page, where the backend is managed
 *   (restart, reinstall or rebuild, clear data, switch). The start page shows forms only when starting fails.
 * - The shell owns the window, the menu bar / tray item and native dialogs, mapping paths for WSL.
 *
 * Nextflow heads run in their own process groups, so closing the app can leave them running ("后台继续"); the
 * next runner adopts them.
 */
const dev = process.argv.includes("--dev");
/** The checkout a development shell runs from (desktop/dist/main.js → repository root). */
const repoRoot = join(__dirname, "..", "..");
const resources = app.isPackaged ? process.resourcesPath : join(__dirname, "..", "resources");
let backend: RunningBackend | undefined;
/** Bumped on every start and stop of the local server, so its old processes are not restarted. */
let localGeneration = 0;
let connectError: string | undefined;
/** What the start page shows: the start-up screen, the recovery view for `target`, or the connection form. */
let startView: { view: "splash" | "recover" | "pick"; target?: Connection } = { view: "pick" };
let lastStatus = "";
/** Set while the backend is being started, stopped or rebuilt, so a second request waits its turn. */
let busy = false;
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
 * The packaged app carries the Next.js server as `app-server.tar.gz` and unpacks it once per build into userData
 * (a development build uses resources/app-server directly). The folder is named by `app-server.build`, the id
 * scripts/bundle.mjs writes beside the archive, so a rebuilt app at an unchanged version never serves the old
 * server. Unpacking goes to a temporary folder that is renamed into place, so an interrupted first start never
 * leaves a half-extracted server behind.
 */
async function appServerDirectory(force = false): Promise<string> {
  const archive = join(resources, "app-server.tar.gz");
  // Unpackaged runs keep the same app version across rebuilds, so a cached copy would serve a stale build.
  if (!app.isPackaged || !existsSync(archive)) return join(resources, "app-server");
  const root = join(app.getPath("userData"), "app-server");
  const buildFile = join(resources, "app-server.build");
  const build = existsSync(buildFile) ? readFileSync(buildFile, "utf8").trim().replace(/[^\w.-]/g, "") : "";
  const name = build ? `${app.getVersion()}-${build}` : app.getVersion();
  const target = join(root, name);
  if (!force && existsSync(join(target, "app-server", "server.js"))) return join(target, "app-server");
  const temporary = `${target}.${process.pid}.tmp`;
  rmSync(temporary, { recursive: true, force: true });
  mkdirSync(temporary, { recursive: true });
  await new Promise<void>((resolve, reject) => execFile("tar", ["-xzf", archive, "-C", temporary], (error) => (error ? reject(error) : resolve())));
  rmSync(target, { recursive: true, force: true });
  renameSync(temporary, target);
  // Other builds' copies are no longer needed.
  for (const entry of readdirSync(root)) if (entry !== name) rmSync(join(root, entry), { recursive: true, force: true });
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
      dialog.showErrorBox(`${productName}：${name} 反复退出`, `最后一次退出码 ${code}。请在设置页导出诊断包，或重启应用。`);
    });
  };
  start();
}

/**
 * There are no migrations: a database written by another schema version is refused by the server, which leaves
 * the app with pages that cannot load. Before the local server starts, such data (database, example project, run
 * records, launch and work directories) is deleted so the server starts fresh. Settings, the toolchain, logs,
 * the unpacked server and connections are kept; projects in their own folders are not touched.
 */
function clearStaleLocalData() {
  const data = dataDirectory({ env: baseEnv });
  const database = join(data, "studio.sqlite");
  if (!existsSync(database)) return;
  let version: number;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    const db = new DatabaseSync(database, { readOnly: true });
    try {
      version = Number(db.prepare("PRAGMA user_version").get()?.user_version ?? 0);
    } finally {
      db.close();
    }
  } catch (error) {
    console.warn("Could not read the local database version", error);
    return;
  }
  if (version === SCHEMA_VERSION) return;
  console.warn(`Local data has schema version ${version}, this app uses ${SCHEMA_VERSION}: clearing it`);
  clearLocalData();
}

/** "清除数据" for the local server (stopped first); the same entries as for WSL and SSH. */
function clearLocalData() {
  const data = dataDirectory({ env: baseEnv });
  for (const name of DATA_ENTRIES) rmSync(join(data, name), { recursive: true, force: true });
}

/** Build id of the bundled local server, so the welcome page can show which build answers. */
function localBuild(): string | undefined {
  const file = app.isPackaged ? join(resources, "app-server.build") : join(resources, "BUILD");
  try { return readFileSync(file, "utf8").trim() || undefined; } catch { return undefined; }
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
  const serverDir = await appServerDirectory(context.forceInstall);
  // Pages another build of this folder rendered must not be served with this build's scripts.
  clearRouteCache(serverDir);
  clearStaleLocalData();
  const build = localBuild();
  const env = serviceEnv({ PORT: String(port), HOSTNAME: "127.0.0.1", NEXTFLOW_STUDIO_SESSION_TOKEN: token, ...(build ? { NEXTFLOW_STUDIO_BUILD: build } : {}) });
  supervise("web", join(serverDir, "server.js"), [], env, serverDir);
  supervise("runner", join(resources, "runner", "runner.mjs"), [], serviceEnv(), join(resources, "runner"), true);
  const health = await waitForHealth(origin, token);
  return {
    origin,
    token,
    server: { version: health.appVersion, build: health.build },
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
const fromBackendPage = (event: Electron.IpcMainInvokeEvent) => {
  const url = event.senderFrame?.url;
  return Boolean(backend && url && (url === backend.origin || url.startsWith(`${backend.origin}/`)));
};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: productName,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    backgroundColor: "#0b1020",
    webPreferences: { preload: join(__dirname, "preload.js"), contextIsolation: true, sandbox: true, nodeIntegration: false, additionalArguments: [`--studio-version=${app.getVersion()}`] },
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
  else {
    if (startView.view === "splash" && !busy) startView = { view: "pick" };
    void window.loadFile(connectPage());
  }
  window.show();
  window.focus();
}

/** The bundled start page in one of its views (see `startView`). */
function showStart(view: typeof startView) {
  startView = view;
  if (view.view === "splash") lastStatus = "";
  const window = mainWindow ?? createWindow();
  void window.loadFile(connectPage());
  window.show();
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Runs `task` (stop, rebuild, start…) for `target` behind the start-up screen. On failure the start page shows
 * the error with retry, reinstall and "use another backend".
 */
async function withStartScreen(target: Connection, task: () => Promise<void>) {
  if (busy) return;
  busy = true;
  showStart({ view: "splash", target });
  try {
    await task();
  } catch (error) {
    connectError = message(error);
    showStart({ view: "recover", target });
  } finally {
    busy = false;
  }
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
  tray.setToolTip(activeRuns ? `${productName}：${activeRuns} 个运行中` : productName);
  if (process.platform === "darwin") tray.setTitle(activeRuns ? `${activeRuns}` : "");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: activeRuns ? `${activeRuns} 个运行中` : "没有运行中的流程", enabled: false },
    { label: `打开 ${productName}`, click: showWindow },
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
    { label: "关闭项目", enabled: Boolean(current), click: () => sendMenu({ type: "close-project" }) },
    { type: "separator" },
    { label: backend ? `后端环境…（当前：${backend.info.label}）` : "连接后端…", click: () => (backend ? sendMenu({ type: "manage-backend" }) : showStart({ view: "pick" })) },
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

  // The start page (bundled file) only.
  ipcMain.handle("connect:state", (event) => {
    if (!fromConnectPage(event)) return null;
    const error = startView.view === "recover" ? connectError : undefined;
    return {
      ...backendList(),
      view: startView.view,
      target: startView.target ? { ...startView.target, detail: connectionDetail(startView.target) } : undefined,
      status: lastStatus,
      error,
      dev,
      version: app.getVersion(),
      product: { id: getProductTheme().id, displayName: productName, shortName: getProductTheme().shortName },
    };
  });
  ipcMain.handle("connect:distros", (event) => (fromConnectPage(event) ? wslDistros() : []));
  ipcMain.handle("connect:install-wsl", (event) => (fromConnectPage(event) ? installWsl() : { ok: false, error: "不允许" }));
  ipcMain.handle("connect:remove", (event, id: unknown) => (fromConnectPage(event) && typeof id === "string" ? removeConnection(id) : loadConnections()));
  ipcMain.handle("connect:start", (event, input: unknown, token: unknown) => {
    if (!fromConnectPage(event)) return { ok: false, error: "不允许" };
    try {
      const connection = readConnection(input);
      void withStartScreen(connection, () => connect(connection, typeof token === "string" && token ? token : undefined));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: message(error) };
    }
  });
  ipcMain.handle("connect:retry", (event, options: unknown) => {
    const target = startView.target;
    if (!fromConnectPage(event) || !target) return { ok: false, error: "没有可重试的后端" };
    const reinstall = Boolean((options as { reinstall?: unknown } | null)?.reinstall);
    void maintain(target, reinstall ? "reinstall" : "retry");
    return { ok: true };
  });

  // The connected server's pages (welcome page: 后端环境).
  ipcMain.handle("backend:info", (event) => (fromBackendPage(event) ? backendInfo() : null));
  ipcMain.handle("backend:list", (event) => (fromBackendPage(event) ? backendList() : null));
  ipcMain.handle("backend:distros", (event) => (fromBackendPage(event) ? wslDistros() : []));
  ipcMain.handle("backend:install-wsl", (event) => (fromBackendPage(event) ? installWsl() : { ok: false, error: "不允许" }));
  ipcMain.handle("backend:remove", (event, id: unknown) => {
    if (!fromBackendPage(event) || typeof id !== "string" || id === backend?.connection.id) return backendList();
    removeConnection(id);
    return backendList();
  });
  ipcMain.handle("backend:run", async (event, action: unknown) => {
    const current = backend;
    if (!fromBackendPage(event) || !current || busy) return;
    if (action !== "restart" && action !== "reinstall" && action !== "clear-data") return;
    if (!(await confirmStop())) return;
    void maintain(current.connection, action);
  });
  ipcMain.handle("backend:connect", (event, input: unknown, token: unknown) => {
    if (!fromBackendPage(event) || busy) return { ok: false, error: "不允许" };
    try {
      const raw = (input ?? {}) as Record<string, unknown>;
      const connection = readConnection({ ...raw, id: typeof raw.id === "string" && raw.id ? raw.id : `${String(raw.kind)}-${Date.now().toString(36)}` });
      void switchTo(connection, typeof token === "string" && token ? token : undefined);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: message(error) };
    }
  });
}

const context = (options: { forceInstall?: boolean } = {}): BackendContext => ({
  appVersion: app.getVersion(),
  // `pnpm dev:win` builds the package in WSL and puts it here; NEXTFLOW_STUDIO_SERVER_PACKAGES points elsewhere.
  serverPackages: process.env.NEXTFLOW_STUDIO_SERVER_PACKAGES || join(resources, "server"),
  dev: !app.isPackaged,
  forceInstall: options.forceInstall,
  log: serviceLog,
  status: (text) => {
    lastStatus = text;
    mainWindow?.webContents.send("connect:status", text);
  },
});

/** Starts or reaches the server of `connection`, then shows the app in the window. */
async function connect(connection: Connection, token?: string, options: { forceInstall?: boolean } = {}) {
  if (backend) await disconnect();
  const next = await startBackend(connection, context(options), { token: token ?? connectionToken(connection.id), startLocal });
  // Another server build may answer at the same origin: drop cached pages and any service worker (the browser demo's
  // MSW) so the window loads what this server serves.
  await session.defaultSession.clearCache();
  await session.defaultSession.clearStorageData({ storages: ["serviceworkers", "cachestorage"] });
  await session.defaultSession.cookies.set({ url: next.origin, name: SESSION_COOKIE, value: next.token, httpOnly: true, sameSite: "strict", secure: next.origin.startsWith("https:") });
  // One saved entry per backend: connecting again to the same distro, host or address keeps its id.
  next.connection = saveConnection(connection, connection.kind === "url" ? token : undefined);
  backend = next;
  rememberLast(next.connection.id);
  next.onLost((reason) => {
    if (backend !== next) return;
    backend = undefined;
    connectError = reason;
    buildAppMenu();
    updateTray();
    showStart({ view: "recover", target: next.connection });
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

/** "切换": stops the current server (asking about active runs) and starts `connection` behind the start screen. */
async function switchTo(connection: Connection, token?: string) {
  if (backend && !(await confirmStop())) return;
  await withStartScreen(connection, () => connect(connection, token));
}

/**
 * Builds the server from this checkout (development shells only). On Windows this is the WSL half of `pnpm dev:win`:
 * desktop/scripts/wsl-bootstrap.sh piped to /bin/sh in the distro (it installs its own Node.js and pnpm, reads no rc
 * files, and runs dev-server-build.mjs); on macOS and Linux, desktop/scripts/bundle.mjs.
 */
async function rebuild(connection: Connection) {
  const ctx = context();
  if (process.platform === "win32") {
    const script = readFileSync(join(repoRoot, "desktop", "scripts", "wsl-bootstrap.sh"), "utf8").replace(/\r\n/g, "\n");
    const distro = connection.kind === "wsl" ? connection.distro : process.env.NEXTFLOW_STUDIO_WSL_DISTRO;
    ctx.status("在 WSL 里用当前代码构建服务端…");
    await runLogged("wsl.exe", [...(distro ? ["-d", distro] : []), "--exec", "/bin/sh", "-s", "--", repoRoot], { input: script }, ctx);
  } else {
    ctx.status("用当前代码构建服务端…");
    await runLogged(process.env.NEXTFLOW_STUDIO_NODE || "node", [join(repoRoot, "desktop", "scripts", "bundle.mjs")], { cwd: repoRoot }, ctx);
  }
}

/**
 * Restart, reinstall (rebuild first in a development shell) or clear the data of `connection`'s server, then
 * connect again. The server is stopped for real (an SSH server otherwise keeps running when the app disconnects).
 */
async function maintain(connection: Connection, action: DesktopBackendAction | "retry") {
  if (connection.kind === "url" && action !== "retry") return;
  await withStartScreen(connection, async () => {
    await disconnect();
    if (action !== "retry") await stopServer(connection, context());
    if (action === "clear-data") {
      if (connection.kind === "local") clearLocalData(); else await clearServerData(connection, context());
    }
    if (action === "reinstall" && dev) await rebuild(connection);
    await connect(connection, connectionToken(connection.id), { forceInstall: action === "reinstall" });
  });
}

function backendInfo(): DesktopBackendInfo | null {
  if (!backend) return null;
  return { connection: backend.connection, detail: connectionDetail(backend.connection), dev, platform: process.platform, server: backend.server };
}

const backendList = () => ({ ...loadConnections(), currentId: backend?.connection.id, platform: process.platform, localAvailable: process.platform !== "win32" });

/** The first WSL distro on Windows, this computer elsewhere; undefined on Windows without WSL. */
async function defaultConnection(): Promise<Connection | undefined> {
  if (process.platform !== "win32") return LOCAL_CONNECTION;
  const [distro] = await wslDistros();
  return distro ? wslConnection(distro) : undefined;
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
  // No picking at start: the last backend, or the default one, starts behind the start-up screen and the window
  // opens on the welcome page. Only a failure shows the recovery view (retry, reinstall, another backend).
  const store = loadConnections();
  const target = store.connections.find((item) => item.id === store.last) ?? store.connections[0] ?? await defaultConnection();
  if (!target) { showStart({ view: "pick" }); return; }
  await withStartScreen(target, () => connect(target));
}).catch((error: unknown) => {
  dialog.showErrorBox(`${productName} 无法启动`, error instanceof ConnectionError || error instanceof Error ? error.message : String(error));
  app.exit(1);
});
