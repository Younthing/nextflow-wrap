import { spawn } from "node:child_process";
import { closeSync, createWriteStream, openSync } from "node:fs";
import { open } from "node:fs/promises";

export interface CommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  logPath?: string;
  quiet?: boolean;
  signal?: AbortSignal;
  onSpawn?: (pid: number) => void;
  /** Trusted, explicitly configured Bash initialization; argv remains positional, never interpolated. */
  setup?: string;
}

export class CommandError extends Error {
  constructor(message: string, readonly exitCode: number | null, readonly output: string) { super(message); }
}

/** exec preserves the detached head's PID/process group for cancellation and adoption. */
export function commandWithSetup(executable: string, args: string[], setup?: string) {
  if (!setup?.trim()) return { executable, args };
  return {
    executable: "/bin/bash",
    args: ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", [
      'trap \'echo "Nextflow 启动前命令执行失败" >&2\' ERR',
      setup.replace(/\r\n?/g, "\n"),
      "trap - ERR",
      'exec "$@"',
    ].join("\n"), "nextflow-studio", executable, ...args],
  };
}

/** Run literal argv; use Bash only when initialization is explicitly configured. Keep a bounded diagnostic tail. */
export async function runCommand(executable: string, args: string[], options: CommandOptions = {}): Promise<string> {
  options.signal?.throwIfAborted();
  const command = commandWithSetup(executable, args, options.setup);
  const log = options.logPath ? createWriteStream(options.logPath, { flags: "a" }) : undefined;
  const child = spawn(/* turbopackIgnore: true */ command.executable, command.args, {
    cwd: options.cwd,
    env: options.env,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  let tail = "";
  let stopped: string | undefined;
  let streamFailure: Error | undefined;
  let forceTimer: ReturnType<typeof setTimeout> | undefined;
  const signal = (name: NodeJS.Signals) => {
    if (!child.pid) return;
    try {
      if (process.platform === "win32") child.kill(name);
      else process.kill(-child.pid, name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  };
  const stop = (reason: string) => {
    if (stopped) return;
    stopped = reason;
    signal("SIGTERM");
    forceTimer = setTimeout(() => signal("SIGKILL"), 10_000);
    forceTimer.unref();
  };
  const interrupt = () => stop("Interrupted");
  options.signal?.addEventListener("abort", interrupt, { once: true });
  child.once("spawn", () => { if (child.pid) options.onSpawn?.(child.pid); if (options.signal?.aborted) interrupt(); });
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  const timer = setTimeout(() => stop("Command timed out"), options.timeoutMs ?? 10 * 60_000);
  const append = (chunk: string) => {
    tail = (tail + chunk).slice(-128_000);
    if (log && !log.write(chunk)) {
      child.stdout.pause(); child.stderr.pause();
      log.once("drain", () => { child.stdout.resume(); child.stderr.resume(); });
    }
    if (!options.quiet) process.stdout.write(chunk);
  };
  child.stdout.setEncoding("utf8").on("data", append);
  child.stderr.setEncoding("utf8").on("data", append);
  try {
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, terminationSignal) => {
        if (streamFailure) reject(streamFailure);
        else if (code === 0 && !stopped) resolve();
        else reject(new CommandError(`${stopped ?? executable} exited with ${code ?? terminationSignal}\n${tail}`, code, tail));
      });
      log?.once("error", (error) => { streamFailure = error; stop("Could not write command log"); });
    });
    return tail;
  } finally {
    clearTimeout(timer);
    if (forceTimer) clearTimeout(forceTimer);
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    options.signal?.removeEventListener("abort", interrupt);
    if (log) await new Promise<void>((resolve) => log.end(resolve));
  }
}

export interface DetachedProcess {
  pid: number;
  /** Exit code, or null when a signal ended it. Settles only while this process is alive to see it. */
  exited: Promise<number | null>;
}

/**
 * Start a long-lived command in its own process group with output going straight to a file.
 * No pipe ties it to this process, so it keeps running if this process exits and can be adopted later.
 */
export async function spawnDetached(executable: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; logPath: string; setup?: string }): Promise<DetachedProcess> {
  const command = commandWithSetup(executable, args, options.setup);
  const fd = openSync(options.logPath, "a");
  try {
    const child = spawn(/* turbopackIgnore: true */ command.executable, command.args, { cwd: options.cwd, env: options.env, detached: true, stdio: ["ignore", fd, fd] });
    const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));
    await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
    child.unref();
    return { pid: child.pid!, exited };
  } finally {
    closeSync(fd);
  }
}

/** Signal a whole process group; a group that is already gone is not an error. */
export function signalGroup(pid: number, name: NodeJS.Signals) {
  try { process.kill(-pid, name); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
}

/** The last bytes of a log, for an error message. */
export async function logTail(path: string, bytes = 128_000): Promise<string> {
  const file = await open(path, "r").catch(() => undefined);
  if (!file) return "";
  try {
    const { size } = await file.stat();
    const length = Math.min(size, bytes);
    const buffer = Buffer.alloc(length);
    await file.read(buffer, 0, length, size - length);
    return buffer.toString("utf8");
  } finally {
    await file.close();
  }
}
