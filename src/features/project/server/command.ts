import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";

export interface CommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  logPath?: string;
  quiet?: boolean;
  signal?: AbortSignal;
  onSpawn?: (pid: number) => void;
}

export class CommandError extends Error {
  constructor(message: string, readonly exitCode: number | null, readonly output: string) { super(message); }
}

/** Run an argv array without a shell. Keep a bounded diagnostic tail. */
export async function runCommand(executable: string, args: string[], options: CommandOptions = {}): Promise<string> {
  options.signal?.throwIfAborted();
  const log = options.logPath ? createWriteStream(options.logPath, { flags: "a" }) : undefined;
  const child = spawn(executable, args, {
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
