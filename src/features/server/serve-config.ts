import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * `nextflow-studio serve`: one command that runs the web server and the runner on the machine holding the data
 * (this one, WSL, or a server). The desktop app and the browser are only clients of it.
 */
export interface ServeOptions {
  host: string;
  /** 0 picks a free port. */
  port: number;
  token?: string;
  dataDir?: string;
  /** Extra Host names to accept, for a server bound to a non-loopback address. */
  allowedHosts: string[];
}

export class ServeUsageError extends Error {}

export const SERVE_USAGE = `用法：nextflow-studio serve [选项]

  --host <地址>            监听地址，默认 127.0.0.1（远程访问建议用 SSH 隧道）
  --port <端口>            默认 0，自动选择空闲端口
  --token <令牌>           默认读取或生成 <数据目录>/server-token
  --data-dir <目录>        数据目录，默认 ~/.local/share/nextflow-studio
  --allowed-hosts <a,b>    额外接受的 Host 名称（监听非回环地址时需要）`;

export function parseServeArgs(argv: string[], env: Partial<Record<string, string>> = process.env): ServeOptions {
  const options: ServeOptions = { host: "127.0.0.1", port: 0, allowedHosts: [], token: env.NEXTFLOW_STUDIO_SESSION_TOKEN || undefined, dataDir: env.NEXTFLOW_STUDIO_DATA_DIR || undefined };
  const args = argv[0] === "serve" ? argv.slice(1) : argv;
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]!;
    const [name, inline] = flag.includes("=") ? [flag.slice(0, flag.indexOf("=")), flag.slice(flag.indexOf("=") + 1)] : [flag, undefined];
    const value = () => {
      const next = inline ?? args[++index];
      if (next === undefined || (inline === undefined && next.startsWith("--"))) throw new ServeUsageError(`${name} 需要一个值`);
      return next;
    };
    switch (name) {
      case "--host": options.host = value(); break;
      case "--port": {
        const port = Number(value());
        if (!Number.isInteger(port) || port < 0 || port > 65535) throw new ServeUsageError("--port 必须是 0–65535 的整数");
        options.port = port;
        break;
      }
      case "--token": {
        const token = value();
        if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) throw new ServeUsageError("--token 需要 16–128 位字母、数字、- 或 _");
        options.token = token;
        break;
      }
      case "--data-dir": options.dataDir = value(); break;
      case "--allowed-hosts": options.allowedHosts.push(...value().split(",").map((item) => item.trim()).filter(Boolean)); break;
      default: throw new ServeUsageError(`未知选项 ${flag}\n\n${SERVE_USAGE}`);
    }
  }
  return options;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const WILDCARD = new Set(["0.0.0.0", "::", "[::]"]);

/** Host names the session guard must accept: the configured ones, plus a specific bind address. */
export function guardHosts(options: ServeOptions): string[] {
  const hosts = [...options.allowedHosts];
  if (!LOOPBACK.has(options.host) && !WILDCARD.has(options.host)) hosts.push(options.host);
  return [...new Set(hosts.map((host) => host.toLowerCase()))];
}

/** Address the launcher itself uses to reach the server. */
export function probeHost(options: ServeOptions): string {
  if (LOOPBACK.has(options.host) || WILDCARD.has(options.host)) return "127.0.0.1";
  return options.host.includes(":") && !options.host.startsWith("[") ? `[${options.host}]` : options.host;
}

/** The persistent token in `<data>/server-token`, created (mode 0600) on first use. */
export function serverToken(dataDir: string, configured?: string): string {
  if (configured) return configured;
  const file = join(dataDir, "server-token");
  if (existsSync(file)) {
    const saved = readFileSync(file, "utf8").trim();
    if (saved) return saved;
  }
  mkdirSync(dataDir, { recursive: true });
  const token = randomBytes(32).toString("hex");
  writeFileSync(file, `${token}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return token;
}

/** `<data>/server.json`: how to reach the running server. Clients use it to attach instead of starting another. */
export interface ServerState {
  pid: number;
  host: string;
  port: number;
  version: string;
  /** Build id of the running package; absent in servers from before it was recorded. */
  build?: string;
  apiVersion: number;
  startedAt: string;
}

export const serverStateFile = (dataDir: string) => join(dataDir, "server.json");

export function readServerState(dataDir: string): ServerState | undefined {
  try {
    const state = JSON.parse(readFileSync(serverStateFile(dataDir), "utf8")) as Partial<ServerState>;
    if (typeof state.pid !== "number" || typeof state.port !== "number" || typeof state.host !== "string") return undefined;
    return state as ServerState;
  } catch {
    return undefined;
  }
}

export function writeServerState(dataDir: string, state: ServerState) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(serverStateFile(dataDir), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

export function clearServerState(dataDir: string, pid: number) {
  if (readServerState(dataDir)?.pid === pid) rmSync(serverStateFile(dataDir), { force: true });
}

export function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

/**
 * The single machine-readable line on stdout once the server answers. Launchers (the desktop app over `wsl.exe`
 * or `ssh`) look for the line starting with `{"event":"ready"`; everything else on stdout is log output.
 */
export interface ReadyLine {
  event: "ready";
  host: string;
  port: number;
  token: string;
  version: string;
  /** Build id of the server that answers; launchers replace a reused server from another build. */
  build?: string;
  apiVersion: number;
  pid: number;
  /** An already running server was found and reused; this process exits right away. */
  reused: boolean;
}

export const readyLine = (ready: Omit<ReadyLine, "event">) => JSON.stringify({ event: "ready", ...ready } satisfies ReadyLine);

export function parseReadyLine(line: string): ReadyLine | undefined {
  if (!line.startsWith('{"event":"ready"')) return undefined;
  try {
    const parsed = JSON.parse(line) as Partial<ReadyLine>;
    if (parsed.event !== "ready" || typeof parsed.port !== "number" || typeof parsed.token !== "string") return undefined;
    return parsed as ReadyLine;
  } catch {
    return undefined;
  }
}

/** The link a person opens: it sets the session cookie once, then the address bar drops the token. */
export function browserLink(host: string, port: number, token: string): string {
  const shown = WILDCARD.has(host) ? "127.0.0.1" : host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${shown}:${port}/?token=${token}`;
}
