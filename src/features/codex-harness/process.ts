import { spawn, type ChildProcess } from "node:child_process";
import { statSync } from "node:fs";
import { createInterface } from "node:readline";

import { AsyncQueue } from "./async-queue";
import { CodexHarnessError } from "./errors";

export interface CodexSpawnSpec {
  binaryPath: string;
  args: string[];
  cwd?: string;
}

export interface CodexChildExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

/** A stdio peer. Production uses `spawnCodexChild`; tests supply a fake. */
export interface CodexChild {
  writeLine(line: string): void;
  lines(): AsyncIterable<string>;
  stderrTail(): string;
  spawnError(): NodeJS.ErrnoException | undefined;
  close(): Promise<void>;
  readonly exited: Promise<CodexChildExit>;
}

/**
 * Spawn `codex` (or another binary) without a shell.
 * Stderr is drained so diagnostics cannot fill the pipe and stall JSON-RPC.
 * The tail is kept only for error text. This module never reads `~/.codex`.
 */
export function spawnCodexChild(spec: CodexSpawnSpec): CodexChild {
  if (spec.cwd) assertCwd(spec.cwd);
  const child = spawn(spec.binaryPath, spec.args, {
    cwd: spec.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
    detached: process.platform !== "win32",
    windowsHide: true,
  });
  if (!child.stdin || !child.stdout || !child.stderr) {
    child.kill();
    throw new CodexHarnessError("failed to open codex stdio pipes");
  }
  return new NodeCodexChild(child);
}

function assertCwd(cwd: string): void {
  try {
    if (!statSync(cwd).isDirectory()) throw new CodexHarnessError(`cwd is not a directory: ${cwd}`);
  } catch (error) {
    if (error instanceof CodexHarnessError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new CodexHarnessError(`cwd does not exist: ${cwd}`);
    throw error;
  }
}

class NodeCodexChild implements CodexChild {
  readonly exited: Promise<CodexChildExit>;
  private readonly stdout = new AsyncQueue<string>();
  private stderr = "";
  private spawnFailure: NodeJS.ErrnoException | undefined;
  private exitResult: CodexChildExit | undefined;
  private closing: Promise<void> | undefined;

  constructor(private readonly child: ChildProcess) {
    const stdin = child.stdin;
    const stdout = child.stdout;
    const stderr = child.stderr;
    if (!stdin || !stdout || !stderr) throw new CodexHarnessError("failed to open codex stdio pipes");

    stdin.on("error", () => undefined);
    stdout.on("error", () => undefined);
    stderr.on("error", () => undefined);
    stderr.setEncoding("utf8");
    stderr.on("data", (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-8_000);
    });

    const lines = createInterface({ input: stdout, crlfDelay: Infinity });
    lines.on("line", (line) => this.stdout.push(line));
    lines.on("close", () => this.stdout.close());
    lines.on("error", () => this.stdout.close());

    this.exited = new Promise((resolve) => {
      const finish = (result: CodexChildExit) => {
        if (this.exitResult) return;
        this.exitResult = result;
        lines.close();
        this.stdout.close();
        resolve(result);
      };
      child.once("error", (error: NodeJS.ErrnoException) => {
        this.spawnFailure = error;
      });
      child.once("close", (code, signal) => finish({ code, signal }));
    });
  }

  writeLine(line: string): void {
    const stdin = this.child.stdin;
    if (!stdin || this.exitResult || !stdin.writable) throw new CodexHarnessError("codex stdin is closed");
    stdin.write(`${line}\n`);
  }

  lines(): AsyncIterable<string> {
    return this.stdout;
  }

  stderrTail(): string {
    return this.stderr;
  }

  spawnError(): NodeJS.ErrnoException | undefined {
    return this.spawnFailure;
  }

  close(): Promise<void> {
    this.closing ??= this.shutdown();
    return this.closing;
  }

  private async shutdown(): Promise<void> {
    try {
      this.child.stdin?.end();
    } catch {
      /* The process may already be gone. */
    }
    if (this.exitResult) return;
    this.signal("SIGTERM");
    const timer = setTimeout(() => this.signal("SIGKILL"), 2_000);
    timer.unref();
    try {
      await this.exited;
    } finally {
      clearTimeout(timer);
    }
  }

  private signal(name: NodeJS.Signals): void {
    const pid = this.child.pid;
    if (!pid || this.exitResult) return;
    try {
      if (process.platform === "win32") this.child.kill(name);
      else process.kill(-pid, name);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ESRCH" && code !== "EPERM") return;
      try {
        this.child.kill(name);
      } catch {
        /* Already exited. */
      }
    }
  }
}
