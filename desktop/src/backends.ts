import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync, type WriteStream } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { createInterface } from "node:readline";

import {
  CLEAR_DATA_SCRIPT, type Connection, ConnectionError, installCommand, needsInstall, parseProbe, parseWslList, PROBE_SCRIPT, serverArch,
  serverPackageName, SSH_START_SCRIPT, sshArgs, STOP_SCRIPT, WSL_SERVE_COMMAND,
} from "../../src/features/desktop/connections";
import { SESSION_HEADER } from "../../src/features/desktop/session-guard";
import { parseReadyLine, type ReadyLine } from "../../src/features/server/serve-config";
import { API_VERSION, type HealthStatus } from "../../src/lib/api-types";

/**
 * A server the window can talk to, started or reached through one `Connection`. The shell only needs its origin
 * and token, and how to let it go: files are always the server's, whichever kind of backend it is.
 */
export interface RunningBackend {
  connection: Connection;
  origin: string;
  token: string;
  info: { kind: Connection["kind"]; label: string };
  /** Version and build of the server that answered (from /api/health). */
  server: { version?: string; build?: string };
  /** The server stops when the app quits (local, WSL); a remote one keeps running. */
  stopsWithApp: boolean;
  /** Called once if the backend goes away on its own (WSL exits, the tunnel cannot be restored). */
  onLost(listener: (reason: string) => void): void;
  stop(): Promise<void>;
}

export interface BackendContext {
  appVersion: string;
  /** Folder holding `nextflow-studio-server-<version>-linux-<arch>.tar.gz`. */
  serverPackages: string;
  /** A development shell (`pnpm dev:win`): the package must come from this checkout, never an older install. */
  dev?: boolean;
  /** Install the bundled package even when the target already has this build ("重新安装服务端"). */
  forceInstall?: boolean;
  log: (name: string) => WriteStream;
  status: (message: string) => void;
}

export function freePort(host = "127.0.0.1"): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      server.close(() => (typeof address === "object" && address ? resolve(address.port) : reject(new Error("no port"))));
    });
  });
}

/** Waits for `/api/health`; checks that the server speaks this shell's API. */
export async function waitForHealth(origin: string, token: string, timeoutMs = 60_000): Promise<HealthStatus> {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/api/health`, { headers: { [SESSION_HEADER]: token } });
      if (response.status === 403) throw new ConnectionError("令牌不正确");
      if (response.ok) {
        const health = await response.json() as HealthStatus;
        if (health.apiVersion !== undefined && health.apiVersion !== API_VERSION) {
          throw new ConnectionError(`服务端 ${health.appVersion ?? ""} 与桌面端不兼容（接口版本 ${health.apiVersion}，需要 ${API_VERSION}），请升级服务端`);
        }
        return health;
      }
      last = `HTTP ${response.status}`;
    } catch (error) {
      if (error instanceof ConnectionError) throw error;
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new ConnectionError(`服务端没有响应（${last}）`);
}

interface Run { code: number | null; stdout: Buffer; stderr: string }

/** Runs a command to the end, feeding `input` on stdin. */
function run(command: string, args: string[], input?: string | Buffer, timeoutMs = 120_000): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const out: Buffer[] = [];
    let err = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => { err = (err + chunk.toString()).slice(-4000); });
    child.on("error", (error: NodeJS.ErrnoException) => { clearTimeout(timer); reject(error.code === "ENOENT" ? new ConnectionError(`找不到 ${command}`) : error); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout: Buffer.concat(out), stderr: err.trim() }); });
    child.stdin.on("error", () => { /* The command exited before reading all of stdin. */ });
    child.stdin.end(input);
  });
}

const failure = (what: string, result: Run) => new ConnectionError(`${what}失败：${result.stderr.split("\n").slice(-3).join(" ") || `退出码 ${result.code}`}`);

interface ServerPackage { name: string; file: string; build?: string }

/** The bundled server package for `arch`, with its build id; undefined when the app does not carry one. */
function serverPackage(context: BackendContext, arch: "x64" | "arm64"): ServerPackage | undefined {
  const name = serverPackageName(context.appVersion, arch);
  const file = join(context.serverPackages, `${name}.tar.gz`);
  if (!existsSync(file)) return undefined;
  const buildFile = join(context.serverPackages, `${name}.build`);
  return { name, file, build: existsSync(buildFile) ? readFileSync(buildFile, "utf8").trim() || undefined : undefined };
}

// ---------------------------------------------------------------------------------------------------------------
// WSL

export async function wslDistros(): Promise<string[]> {
  if (process.platform !== "win32") return [];
  const result = await run("wsl.exe", ["-l", "-q"], undefined, 20_000).catch(() => undefined);
  return result?.code === 0 ? parseWslList(result.stdout) : [];
}

/**
 * `wsl --install` (WSL plus the default Ubuntu) needs administrator rights: Windows shows its UAC prompt. The
 * installer opens its own console, where Ubuntu asks for a Linux user name; some machines need a restart first.
 */
export async function installWsl(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (process.platform !== "win32") return { ok: false, error: "只有 Windows 需要安装 WSL" };
  const result = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Start-Process -FilePath wsl.exe -ArgumentList '--install' -Verb RunAs -Wait"], undefined, 3_600_000)
    .catch((error: unknown) => ({ code: 1, stdout: Buffer.alloc(0), stderr: error instanceof Error ? error.message : String(error) }));
  if (result.code === 0) return { ok: true };
  // Declining the UAC prompt ends Start-Process with "The operation was canceled by the user".
  return { ok: false, error: /cancel|取消/i.test(result.stderr) ? "已取消安装" : `安装 WSL 失败：${result.stderr.split("\n").slice(-2).join(" ")}` };
}

/**
 * `sh` in the distro, script on stdin. `--exec` runs it directly: with `--`, wsl.exe hands the joined command line
 * to the login shell, which eats the backslashes of Windows paths passed as arguments.
 */
const wsl = (distro: string, script: string, args: string[] = [], timeoutMs?: number) => run("wsl.exe", ["-d", distro, "--exec", "sh", "-l", "-s", "--", ...args], script, timeoutMs);

/**
 * Installs the bundled server package when the target has another version or another build of it. A server still
 * running from the old files is stopped first, so the next start runs the new ones. Returns the version and build
 * the started server must report.
 */
async function ensureInstalled(context: BackendContext, probe: () => Promise<Run>, install: (pkg: ServerPackage) => Promise<Run>, stop: () => Promise<Run>, where: string): Promise<{ version: string; build?: string }> {
  context.status(`检查${where}上的服务端…`);
  const probed = await probe();
  if (probed.code !== 0) throw failure(`连接${where}`, probed);
  const installed = parseProbe(probed.stdout.toString());
  const packageArch = serverArch(installed.arch ?? "");
  const pkg = packageArch ? serverPackage(context, packageArch) : undefined;
  const wanted = { version: context.appVersion, build: pkg?.build };
  // Without a package the shell cannot tell an old install from the current code. A development shell refuses;
  // the released app only goes on when the installed server is its own version (one installed by hand, say on
  // an architecture the app does not carry).
  if (!pkg && (context.dev || installed.version !== context.appVersion)) {
    throw new ConnectionError(context.dev
      ? `开发版在 ${context.serverPackages} 里没有服务端包，${where}只有以前装的旧服务端。用 pnpm dev:win 启动（会先用当前代码构建服务端），或在首页的「后端环境」里点「重新构建」`
      : `安装包里没有${where}可用的服务端（${packageArch ? serverPackageName(context.appVersion, packageArch) : `架构 ${installed.arch ?? "未知"} 不受支持`}），请按 docs/server.md 在目标机器上手动安装`);
  }
  if (!context.forceInstall && !needsInstall(installed, wanted)) return wanted;
  if (!packageArch) throw new ConnectionError(`${where}的架构 ${installed.arch ?? "未知"} 不受支持`);
  if (!pkg) throw new ConnectionError(`安装包里没有 ${serverPackageName(context.appVersion, packageArch)}，请按 docs/server.md 在目标机器上手动安装`);
  context.status(installed.version === context.appVersion ? `更新${where}上的服务端…` : installed.version ? `更新${where}上的服务端 ${installed.version} → ${context.appVersion}…` : `在${where}上安装服务端 ${context.appVersion}…`);
  if (installed.version) await stop();
  const result = await install(pkg);
  if (result.code !== 0) throw failure("安装服务端", result);
  return wanted;
}

/** The server that answered must be the build just installed; anything else is a stale process or install. */
function checkBuild(health: HealthStatus, wanted: { version: string; build?: string }, where: string) {
  if (wanted.build && health.build !== wanted.build) {
    throw new ConnectionError(`${where}上运行的服务端（构建 ${health.build ?? "未知"}）不是刚安装的构建 ${wanted.build}。请点「重新安装服务端」`);
  }
}

/** Reads the launcher's stdout until its ready line; the process keeps running afterwards. */
function readyFrom(child: ChildProcessWithoutNullStreams, log: WriteStream, timeoutMs = 180_000): Promise<ReadyLine> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stderr = "";
    const timer = setTimeout(() => finish(new ConnectionError("服务端 180 秒内没有就绪")), timeoutMs);
    const finish = (result: ReadyLine | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (result instanceof Error) reject(result); else resolve(result);
    };
    createInterface({ input: child.stdout }).on("line", (line) => {
      log.write(`${line}\n`);
      const ready = parseReadyLine(line);
      if (ready) finish(ready);
    });
    child.stderr.on("data", (chunk: Buffer) => { log.write(chunk); stderr = (stderr + chunk.toString()).slice(-2000); });
    child.on("error", (error) => finish(error));
    child.on("exit", (code) => finish(new ConnectionError(`服务端退出（${code}）：${stderr.trim().split("\n").slice(-3).join(" ")}`)));
  });
}

async function startWsl(connection: Extract<Connection, { kind: "wsl" }>, context: BackendContext): Promise<RunningBackend> {
  const { distro } = connection;
  const wanted = await ensureInstalled(
    context,
    () => wsl(distro, PROBE_SCRIPT, [], 60_000),
    (pkg) => wsl(distro, installCommand(pkg.name, "arg"), [pkg.file], 300_000),
    () => wsl(distro, STOP_SCRIPT, [], 60_000),
    ` WSL（${distro}）`,
  );
  const launch = async () => {
    context.status(`启动 WSL（${distro}）里的服务端…`);
    const child = spawn("wsl.exe", ["-d", distro, "--exec", "sh", "-l", "-s"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    child.stdin.end(WSL_SERVE_COMMAND);
    return { child, ready: await readyFrom(child, context.log("wsl")) };
  };
  let { child, ready } = await launch();
  // A server started before the update (another version or build) is still answering: replace it.
  if (ready.reused && needsInstall(ready, wanted)) {
    context.status("停止旧的服务端…");
    await wsl(distro, STOP_SCRIPT, [], 60_000);
    ({ child, ready } = await launch());
  }
  const origin = `http://127.0.0.1:${ready.port}`;
  context.status("等待服务端响应…");
  const health = await waitForHealth(origin, ready.token);
  checkBuild(health, wanted, ` WSL（${distro}）`);
  const lost: ((reason: string) => void)[] = [];
  let stopping = false;
  child.on("exit", (code) => { if (!stopping) for (const listener of lost) listener(`WSL 里的服务端已退出（${code}）`); });
  return {
    connection,
    origin,
    token: ready.token,
    info: { kind: "wsl", label: connection.label },
    server: { version: health.appVersion, build: health.build },
    stopsWithApp: true,
    onLost: (listener) => { lost.push(listener); },
    stop: async () => {
      stopping = true;
      // serve stops web and runner on SIGTERM; started Nextflow runs keep going.
      await wsl(distro, `kill -TERM ${Number(ready.pid)} 2>/dev/null || true`, [], 20_000).catch(() => undefined);
      setTimeout(() => child.kill(), 15_000).unref();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// SSH

/** The ssh client; `NEXTFLOW_STUDIO_SSH` points at another one (tests, unusual installs), as in the server. */
const ssh = () => process.env.NEXTFLOW_STUDIO_SSH?.trim() || "ssh";

async function startSsh(connection: Extract<Connection, { kind: "ssh" }>, context: BackendContext): Promise<RunningBackend> {
  const args = sshArgs(connection);
  const where = ` ${connection.target} `;
  const wanted = await ensureInstalled(
    context,
    () => run(ssh(), [...args, "sh -s"], PROBE_SCRIPT, 60_000),
    (pkg) => run(ssh(), [...args, `sh -c '${installCommand(pkg.name, "stdin")}'`], readFileSync(pkg.file), 600_000),
    () => run(ssh(), [...args, "sh -s"], STOP_SCRIPT, 60_000),
    where,
  );
  const start = async () => {
    context.status(`启动${where}上的服务端…`);
    const started = await run(ssh(), [...args, "sh -s"], SSH_START_SCRIPT, 240_000);
    const ready = started.stdout.toString().split("\n").map(parseReadyLine).find(Boolean);
    if (started.code !== 0 || !ready) throw failure("启动服务端", started);
    return ready;
  };
  let ready = await start();
  if (ready.reused && needsInstall(ready, wanted)) {
    context.status("停止旧的服务端…");
    await run(ssh(), [...args, "sh -s"], STOP_SCRIPT, 60_000);
    ready = await start();
  }

  const localPort = await freePort();
  const origin = `http://127.0.0.1:${localPort}`;
  const log = context.log("ssh-tunnel");
  const lost: ((reason: string) => void)[] = [];
  let stopping = false;
  let tunnel: ChildProcessWithoutNullStreams | undefined;
  let failures = 0;
  const openTunnel = () => {
    const child = spawn(ssh(), ["-N", "-o", "ExitOnForwardFailure=yes", "-L", `${localPort}:127.0.0.1:${ready.port}`, ...args], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    tunnel = child;
    child.stderr.on("data", (chunk: Buffer) => log.write(chunk));
    child.on("exit", (code) => {
      log.write(`--- ${new Date().toISOString()} tunnel exited with ${code}\n`);
      if (stopping) return;
      // Laptops sleep and Wi-Fi drops: reopen the tunnel a few times before giving up.
      if (++failures > 5) { for (const listener of lost) listener(`到 ${connection.target} 的连接已断开`); return; }
      setTimeout(openTunnel, Math.min(15_000, 1_000 * 2 ** failures));
    });
  };
  openTunnel();
  context.status("建立 SSH 隧道…");
  const health = await waitForHealth(origin, ready.token, 60_000).catch((error: unknown) => { stopping = true; tunnel?.kill(); throw error; });
  failures = 0;
  try { checkBuild(health, wanted, where); } catch (error) { stopping = true; tunnel?.kill(); throw error; }
  return {
    connection,
    origin,
    token: ready.token,
    info: { kind: "ssh", label: connection.label },
    server: { version: health.appVersion, build: health.build },
    stopsWithApp: false,
    onLost: (listener) => { lost.push(listener); },
    // The server keeps running on the remote machine (kernels, runs); only the tunnel closes.
    stop: async () => { stopping = true; tunnel?.kill(); },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// URL

async function attachUrl(connection: Extract<Connection, { kind: "url" }>, token: string | undefined, context: BackendContext): Promise<RunningBackend> {
  if (!token) throw new ConnectionError("缺少令牌");
  context.status(`连接 ${connection.url}…`);
  const health = await waitForHealth(connection.url, token, 15_000);
  return {
    connection,
    origin: connection.url,
    token,
    info: { kind: "url", label: connection.label },
    server: { version: health.appVersion, build: health.build },
    stopsWithApp: false,
    onLost: () => {},
    stop: async () => {},
  };
}

export interface LocalStarter {
  (context: BackendContext): Promise<{ origin: string; token: string; server: RunningBackend["server"]; stop: () => Promise<void> }>;
}

/**
 * Stops the server of a WSL or SSH connection (a remote one keeps running when the app only disconnects), so a
 * restart really starts it again. Local servers stop with `RunningBackend.stop`; a URL is not ours to stop.
 */
export async function stopServer(connection: Connection, context: BackendContext) {
  if (connection.kind === "wsl") {
    context.status(`停止 WSL（${connection.distro}）里的服务端…`);
    const result = await wsl(connection.distro, STOP_SCRIPT, [], 60_000);
    if (result.code !== 0) throw failure("停止服务端", result);
  } else if (connection.kind === "ssh") {
    context.status(`停止 ${connection.target} 上的服务端…`);
    const result = await run(ssh(), [...sshArgs(connection), "sh -s"], STOP_SCRIPT, 60_000);
    if (result.code !== 0) throw failure("停止服务端", result);
  }
}

/** Clears the data directory of a stopped WSL or SSH server (see DATA_ENTRIES). */
export async function clearServerData(connection: Connection, context: BackendContext) {
  context.status("清除数据…");
  const result = connection.kind === "wsl" ? await wsl(connection.distro, CLEAR_DATA_SCRIPT, [], 120_000)
    : connection.kind === "ssh" ? await run(ssh(), [...sshArgs(connection), "sh -s"], CLEAR_DATA_SCRIPT, 120_000)
      : undefined;
  if (result && result.code !== 0) throw failure("清除数据", result);
}

/**
 * Runs a build step from the window ("重新构建"): its output goes to `<logs>/rebuild.log` and, line by line, to the
 * status line. Used for wsl-bootstrap.sh in WSL (the server half of `pnpm dev:win`) and, on macOS and
 * Linux, for desktop/scripts/bundle.mjs.
 */
export function runLogged(command: string, args: string[], options: { input?: string; cwd?: string; env?: NodeJS.ProcessEnv }, context: BackendContext): Promise<void> {
  return new Promise((resolve, reject) => {
    const log = context.log("rebuild");
    log.write(`--- ${new Date().toISOString()} ${command} ${args.join(" ")}\n`);
    const child = spawn(command, args, { cwd: options.cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env: options.env ?? process.env });
    let tail = "";
    const onLine = (line: string) => {
      log.write(`${line}\n`);
      tail = `${tail}\n${line}`.slice(-2000);
      const shown = line.replace(/^== /, "").trim();
      if (shown) context.status(shown.length > 120 ? `${shown.slice(0, 117)}…` : shown);
    };
    createInterface({ input: child.stdout }).on("line", onLine);
    createInterface({ input: child.stderr }).on("line", onLine);
    child.on("error", (error: NodeJS.ErrnoException) => reject(error.code === "ENOENT" ? new ConnectionError(`找不到 ${command}`) : error));
    child.on("close", (code) => (code === 0 ? resolve() : reject(new ConnectionError(`构建服务端失败（${code}）：${tail.trim().split("\n").slice(-3).join(" ")}`))));
    child.stdin.on("error", () => { /* Exited before reading stdin. */ });
    child.stdin.end(options.input);
  });
}

export async function startBackend(connection: Connection, context: BackendContext, options: { token?: string; startLocal: LocalStarter }): Promise<RunningBackend> {
  switch (connection.kind) {
    case "local": {
      if (process.platform === "win32") throw new ConnectionError("Windows 上请用 WSL 或远程服务器运行服务端");
      const local = await options.startLocal(context);
      return { connection, ...local, info: { kind: "local", label: connection.label }, stopsWithApp: true, onLost: () => {} };
    }
    case "wsl": return startWsl(connection, context);
    case "ssh": return startSsh(connection, context);
    case "url": return attachUrl(connection, options.token, context);
  }
}
