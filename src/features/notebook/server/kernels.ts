import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

import { dataDirectory } from "@/lib/server/database";
import type { KernelInfo, KernelSpecList, KernelState } from "../types";
import { KERNEL_BRIDGE } from "./kernel-bridge";

/** What one cell execution returned, before finalizeCellResult clips it. */
export interface KernelCellReply {
  outputs: unknown[];
  executionCount: number | null;
  status: "ok" | "error" | "aborted" | "dead";
}

/** Jupyter is not installed for the bridge interpreter. Callers fall back to one-shot runs. */
export class KernelUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KernelUnavailableError";
  }
}

const IDLE_SHUTDOWN_MS = Number(process.env.NEXTFLOW_STUDIO_KERNEL_IDLE_MS ?? 2 * 60 * 60_000);
const START_TIMEOUT_MS = 180_000;

/** Interpreter that runs the bridge and, through it, the default python3 kernelspec. */
export const bridgePython = () => process.env.NEXTFLOW_STUDIO_JUPYTER_PYTHON?.trim() || "python3";

/** Working directory a notebook's kernel keeps between runs. Files written by cells stay here. */
export const notebookWorkDir = (notebookId: string) => join(dataDirectory(), "scratch", "notebooks", notebookId);

interface Pending {
  resolve: (reply: KernelCellReply) => void;
  reject: (error: Error) => void;
}

/** One notebook's kernel: a bridge process that owns a Jupyter kernel. */
export class KernelSession {
  readonly notebookId: string;
  readonly requested: string;
  state: KernelState = "starting";
  kernel = "";
  note = "";
  python = "";
  pid: number | null = null;
  startedAt = new Date().toISOString();
  private child?: ChildProcessWithoutNullStreams;
  private ready: Promise<void>;
  private pending = new Map<string, Pending>();
  private serial = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private stderr = "";
  private lastMessage = "";
  private idleTimer?: NodeJS.Timeout;
  private onExit: () => void;

  constructor(notebookId: string, requested: string, cwd: string, onExit: () => void) {
    this.notebookId = notebookId;
    this.requested = requested;
    this.onExit = onExit;
    this.ready = this.start(cwd);
    // Keep an unobserved start failure from crashing the server; execute() reports it.
    this.ready.catch(() => undefined);
  }

  private start(cwd: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(/* turbopackIgnore: true */ bridgePython(), ["-u", "-c", KERNEL_BRIDGE, "--kernel", this.requested, "--cwd", cwd], {
        cwd,
        env: { ...process.env, PYTHONUNBUFFERED: "1", PYDEVD_DISABLE_FILE_VALIDATION: "1" },
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.child = child;
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`内核启动超时（${Math.round(START_TIMEOUT_MS / 1000)} 秒）`));
        this.shutdown();
      }, START_TIMEOUT_MS);
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      };
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => { this.stderr = (this.stderr + chunk).slice(-4000); });
      child.on("error", (error: NodeJS.ErrnoException) => {
        fail(error.code === "ENOENT"
          ? new KernelUnavailableError(`找不到 ${bridgePython()}`)
          : error);
      });
      child.on("exit", (code) => {
        this.state = "dead";
        if (code === 3) fail(new KernelUnavailableError(this.lastMessage || "jupyter_client 不可用"));
        else fail(new Error(this.lastMessage || this.stderr.trim().slice(-1000) || `内核进程退出（${code ?? "信号"}）`));
        for (const [, pending] of this.pending) pending.reject(new Error("内核已退出，重启内核后再运行。"));
        this.pending.clear();
        clearTimeout(this.idleTimer);
        this.onExit();
      });
      const lines = createInterface({ input: child.stdout });
      lines.on("line", (line) => {
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(line) as Record<string, unknown>;
        } catch {
          return;
        }
        if (message.event === "ready") {
          this.kernel = String(message.kernel ?? "");
          this.note = String(message.note ?? "");
          this.python = String(message.python ?? "");
          this.pid = typeof message.pid === "number" ? message.pid : null;
          this.state = "idle";
          this.touch();
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve();
          }
          return;
        }
        if (message.event === "missing" || message.event === "failed") {
          this.lastMessage = String(message.message ?? "");
          return;
        }
        const id = typeof message.id === "string" ? message.id : "";
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        pending.resolve({
          outputs: Array.isArray(message.outputs) ? message.outputs : [],
          executionCount: typeof message.executionCount === "number" ? message.executionCount : null,
          status: message.status === "error" || message.status === "aborted" || message.status === "dead" ? message.status : "ok",
        });
      });
    });
  }

  private touch() {
    clearTimeout(this.idleTimer);
    if (IDLE_SHUTDOWN_MS > 0) {
      this.idleTimer = setTimeout(() => { if (this.state === "idle") this.shutdown(); }, IDLE_SHUTDOWN_MS);
      this.idleTimer.unref?.();
    }
  }

  /** Resolves once the kernel is ready. Rejects with KernelUnavailableError when Jupyter is missing. */
  whenReady(): Promise<void> {
    return this.ready;
  }

  /** Runs one cell after any queued cells. */
  execute(code: string): Promise<KernelCellReply> {
    const next = this.queue.then(async () => {
      await this.ready;
      if (this.state === "dead" || !this.child) throw new Error("内核已退出，重启内核后再运行。");
      const id = `c${++this.serial}`;
      this.state = "busy";
      try {
        return await new Promise<KernelCellReply>((resolve, reject) => {
          this.pending.set(id, { resolve, reject });
          this.child!.stdin.write(`${JSON.stringify({ id, code })}\n`);
        });
      } finally {
        if (this.state === "busy") this.state = "idle";
        this.touch();
      }
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Interrupts the running cell. Queued cells still run unless the caller stops on the error. */
  interrupt() {
    if (this.child && this.state !== "dead") this.child.kill("SIGUSR1");
  }

  /** Stops the kernel. The bridge shuts Jupyter down; a stuck bridge is killed after a grace period. */
  shutdown() {
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    child.stdin.end();
    child.kill("SIGTERM");
    const pid = this.pid;
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      if (pid) {
        try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
      }
    }, 5_000).unref?.();
  }

  info(): KernelInfo {
    return {
      notebookId: this.notebookId,
      state: this.state,
      requested: this.requested,
      kernel: this.kernel || undefined,
      note: this.note || undefined,
      python: this.python || undefined,
      startedAt: this.startedAt,
    };
  }
}

/** Kernels live as long as the server process. A dev-server reload keeps them on globalThis. */
const registry = globalThis as typeof globalThis & { __nfStudioKernels?: Map<string, KernelSession> };
const sessions = (registry.__nfStudioKernels ??= new Map<string, KernelSession>());

/** The notebook's running kernel, started when missing or when the notebook switched kernels. */
export async function kernelFor(notebookId: string, requested: string): Promise<KernelSession> {
  const current = sessions.get(notebookId);
  if (current && current.state !== "dead" && current.requested === requested) return current;
  current?.shutdown();
  const cwd = notebookWorkDir(notebookId);
  await mkdir(cwd, { recursive: true });
  const session: KernelSession = new KernelSession(notebookId, requested, cwd, () => {
    if (sessions.get(notebookId) === session) sessions.delete(notebookId);
  });
  sessions.set(notebookId, session);
  return session;
}

export function existingKernel(notebookId: string): KernelSession | undefined {
  return sessions.get(notebookId);
}

export function kernelInfo(notebookId: string): KernelInfo {
  return sessions.get(notebookId)?.info() ?? { notebookId, state: "stopped" };
}

export function shutdownKernel(notebookId: string) {
  const session = sessions.get(notebookId);
  sessions.delete(notebookId);
  session?.shutdown();
}

export function shutdownAllKernels() {
  for (const id of [...sessions.keys()]) shutdownKernel(id);
}

/** Installed Jupyter kernelspecs for the bridge interpreter. */
export function listKernelSpecs(): Promise<KernelSpecList> {
  return new Promise((resolve) => {
    const child = spawn(/* turbopackIgnore: true */ bridgePython(), ["-c", KERNEL_BRIDGE, "--list"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { out += chunk; });
    const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ available: false, kernels: [], message: `找不到 ${bridgePython()}` });
    });
    child.on("exit", () => {
      clearTimeout(timer);
      try {
        const message = JSON.parse(out.trim().split("\n").pop() ?? "") as { event?: string; python?: string; kernels?: KernelSpecList["kernels"]; message?: string };
        if (message.event === "kernels") {
          resolve({ available: true, python: message.python, kernels: message.kernels ?? [] });
          return;
        }
        resolve({ available: false, kernels: [], message: message.message ?? "jupyter_client 不可用" });
      } catch {
        resolve({ available: false, kernels: [], message: "无法读取 Jupyter 内核列表" });
      }
    });
  });
}

const hooks = globalThis as typeof globalThis & { __nfStudioKernelExitHook?: boolean };
if (!hooks.__nfStudioKernelExitHook) {
  hooks.__nfStudioKernelExitHook = true;
  process.once("exit", () => {
    for (const session of (registry.__nfStudioKernels ?? new Map()).values()) session.shutdown();
  });
}
