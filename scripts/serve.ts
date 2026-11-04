import { fork, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, type WriteStream } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { RestartTracker } from "@/features/desktop/supervisor";
import { SESSION_HEADER } from "@/features/desktop/session-guard";
import { DEFAULT_COPILOT_HOSTS } from "@/features/assistant/request-guard";
import {
  browserLink, clearServerState, guardHosts, parseServeArgs, probeHost, processAlive, readServerState, readyLine,
  SERVE_USAGE, ServeUsageError, serverToken, writeServerState, type ServeOptions,
  clearRouteCache,
} from "@/features/server/serve-config";
import { API_VERSION } from "@/lib/api-types";
import { dataDirectory } from "@/lib/server/paths";
import { getProductTheme } from "@/lib/product-theme";

/**
 * `nextflow-studio serve`: runs the web server (UI, `/api`, notebook kernels) and the Nextflow runner, restarts
 * them when they crash, and prints one `{"event":"ready",...}` line for launchers. See docs/server.md.
 *
 * Layout next to this file (built by scripts/build-server.mjs): app-server/server.js, runner/runner.mjs, plugins/,
 * VERSION. `NEXTFLOW_STUDIO_SERVER_ROOT` points somewhere else.
 */
const root = resolve(process.env.NEXTFLOW_STUDIO_SERVER_ROOT || dirname(fileURLToPath(import.meta.url)));
const version = process.env.NEXTFLOW_STUDIO_APP_VERSION || (existsSync(join(root, "VERSION")) ? readFileSync(join(root, "VERSION"), "utf8").trim() : "dev");
const build = process.env.NEXTFLOW_STUDIO_BUILD || (existsSync(join(root, "BUILD")) ? readFileSync(join(root, "BUILD"), "utf8").trim() : "") || undefined;

function freePort(host: string): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once("error", fail);
    server.listen(0, host, () => {
      const address = server.address();
      server.close(() => (typeof address === "object" && address ? done(address.port) : fail(new Error("no port"))));
    });
  });
}

function serviceLog(dir: string, name: string): WriteStream {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.log`);
  try { if (statSync(file).size > 0) renameSync(file, join(dir, `${name}.1.log`)); } catch { /* First start. */ }
  return createWriteStream(file, { flags: "a" });
}

async function waitForHealth(url: string, token: string, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/health`, { headers: { [SESSION_HEADER]: token } });
      if (response.ok) return;
    } catch { /* Not listening yet. */ }
    await new Promise((wait) => setTimeout(wait, 250));
  }
  throw new Error(`Web 服务没有在 ${timeoutMs / 1000} 秒内响应`);
}

async function main(options: ServeOptions) {
  if (options.dataDir) process.env.NEXTFLOW_STUDIO_DATA_DIR = resolve(options.dataDir);
  const dataDir = dataDirectory();
  const token = serverToken(dataDir, options.token);

  // Another serve for this data directory is still up: report it instead of starting a second web server and runner.
  const running = readServerState(dataDir);
  if (running && running.pid !== process.pid && processAlive(running.pid)) {
    console.log(readyLine({ host: running.host, port: running.port, token, version: running.version, build: running.build, apiVersion: running.apiVersion, pid: running.pid, reused: true }));
    return;
  }

  const serverJs = join(root, "app-server", "server.js");
  const runnerJs = join(root, "runner", "runner.mjs");
  for (const file of [serverJs, runnerJs]) if (!existsSync(file)) throw new Error(`找不到 ${file}。先运行 node scripts/build-server.mjs。`);
  clearRouteCache(join(root, "app-server"));

  const port = options.port || await freePort(options.host);
  const hosts = guardHosts(options);
  const logs = join(dataDir, "logs");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NEXTFLOW_STUDIO_DATA_DIR: dataDir,
    NEXTFLOW_STUDIO_APP_VERSION: version,
    ...(build ? { NEXTFLOW_STUDIO_BUILD: build } : {}),
    NEXTFLOW_STUDIO_BUNDLED_PLUGINS: join(root, "plugins"),
    NEXTFLOW_STUDIO_LOG_DIR: logs,
    NEXT_PUBLIC_API_MOCKING: "disabled",
    NODE_ENV: "production",
  };
  const webEnv: NodeJS.ProcessEnv = {
    ...env,
    PORT: String(port),
    HOSTNAME: options.host,
    NEXTFLOW_STUDIO_SESSION_TOKEN: token,
    ...(hosts.length ? { NEXTFLOW_STUDIO_ALLOWED_HOSTS: hosts.join(","), COPILOT_ALLOWED_HOSTS: [...DEFAULT_COPILOT_HOSTS, ...hosts.map((host) => host.replace(/:\d+$/, ""))].join(",") } : {}),
  };

  const children = new Map<string, ChildProcess>();
  let stopping = false;
  const stop = (code: number) => {
    if (stopping) return;
    stopping = true;
    clearServerState(dataDir, process.pid);
    // SIGTERM lets the runner leave started Nextflow heads running and the web server shut kernels down.
    for (const child of children.values()) child.kill("SIGTERM");
    const deadline = setTimeout(() => {
      for (const child of children.values()) child.kill("SIGKILL");
      process.exit(code);
    }, 15_000);
    deadline.unref();
    const wait = () => { if (children.size === 0) process.exit(code); else setTimeout(wait, 100); };
    wait();
  };

  const supervise = (name: string, modulePath: string, childEnv: NodeJS.ProcessEnv, keepTrying = false) => {
    const restarts = new RestartTracker();
    let givenUp = false;
    const log = serviceLog(logs, name);
    const start = () => {
      log.write(`--- ${new Date().toISOString()} start ${name} ${version}\n`);
      const child = fork(modulePath, [], { cwd: dirname(modulePath), env: childEnv, stdio: ["ignore", "pipe", "pipe", "ipc"] });
      children.set(name, child);
      child.stdout?.on("data", (chunk: Buffer) => { log.write(chunk); process.stderr.write(`[${name}] ${chunk}`); });
      child.stderr?.on("data", (chunk: Buffer) => { log.write(chunk); process.stderr.write(`[${name}] ${chunk}`); });
      const healthy = setTimeout(() => { restarts.healthy(); givenUp = false; }, 60_000);
      child.once("exit", (code, signal) => {
        log.write(`--- ${new Date().toISOString()} ${name} exited with ${code ?? signal}\n`);
        clearTimeout(healthy);
        children.delete(name);
        if (stopping) return;
        const delay = restarts.crash(Date.now());
        if (delay !== undefined) { setTimeout(start, delay); return; }
        // Without the web server there is nothing to serve.
        if (!keepTrying) {
          console.error(`${name} 反复退出（最后一次 ${code ?? signal}），停止服务。日志：${join(logs, `${name}.log`)}`);
          stop(1);
          return;
        }
        // The runner fails until Java and Nextflow exist; the setup page installs them, so keep checking.
        if (!givenUp) console.error(`${name} 反复退出（最后一次 ${code ?? signal}），每 30 秒重试。日志：${join(logs, `${name}.log`)}`);
        givenUp = true;
        restarts.healthy();
        setTimeout(start, 30_000);
      });
    };
    start();
  };

  process.once("SIGINT", () => stop(0));
  process.once("SIGTERM", () => stop(0));
  process.once("SIGHUP", () => stop(0));

  supervise("web", serverJs, webEnv);
  supervise("runner", runnerJs, env, true);
  try {
    await waitForHealth(`http://${probeHost(options)}:${port}`, token);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    stop(1);
    return;
  }
  writeServerState(dataDir, { pid: process.pid, host: options.host, port, version, build, apiVersion: API_VERSION, startedAt: new Date().toISOString() });
  // Logs go to stderr, so stdout carries only this line (launchers read it) and the link for people.
  console.log(readyLine({ host: options.host, port, token, version, build, apiVersion: API_VERSION, pid: process.pid, reused: false }));
  console.log(`${getProductTheme().displayName} ${version} 已启动：${browserLink(options.host, port, token)}`);
  console.log(`数据目录 ${dataDir}`);
}

let options: ServeOptions;
try {
  if (process.argv.includes("--help") || process.argv.includes("-h")) { console.log(SERVE_USAGE); process.exit(0); }
  options = parseServeArgs(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof ServeUsageError ? error.message : error);
  process.exit(2);
}
main(options).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
