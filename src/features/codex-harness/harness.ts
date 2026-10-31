import { CodexHarnessError } from "./errors";
import { createJsonRpc } from "./jsonrpc";
import { spawnCodexChild } from "./process";
import { isRecord, readString } from "./record";
import { CodexAppSession, type ResolvedSessionOptions } from "./session";
import type { CodexHarness, CodexHarnessOptions, OpenSessionOptions, ProbeResult } from "./types";

/** Optional catalog lookup. A stall must not hide an auth result already in hand. */
const MODEL_LIST_PROBE_MS = 400;

const CLIENT_INFO = {
  clientInfo: {
    name: "nextflow_wrap",
    title: "Nextflow Studio",
    version: "0.1.0",
  },
};

/**
 * `thread/start.sandbox` is `SandboxMode` (kebab-case).
 * `turn/start.sandboxPolicy.type` is `SandboxPolicy` (camelCase).
 * Callers may pass either spelling.
 */
const SANDBOX = {
  "read-only": { thread: "read-only", turn: "readOnly" },
  readonly: { thread: "read-only", turn: "readOnly" },
  readOnly: { thread: "read-only", turn: "readOnly" },
  "workspace-write": { thread: "workspace-write", turn: "workspaceWrite" },
  workspaceWrite: { thread: "workspace-write", turn: "workspaceWrite" },
  "danger-full-access": { thread: "danger-full-access", turn: "dangerFullAccess" },
  dangerFullAccess: { thread: "danger-full-access", turn: "dangerFullAccess" },
} as const;

/** `AskForApproval` on the wire is kebab-case. CamelCase aliases are accepted. */
const APPROVAL = {
  never: "never",
  "on-request": "on-request",
  onRequest: "on-request",
  untrusted: "untrusted",
  unlessTrusted: "untrusted",
} as const;

export function createCodexHarness(options: CodexHarnessOptions = {}): CodexHarness {
  const spawn = options.spawn ?? spawnCodexChild;
  const binaryPath = options.binaryPath ?? "codex";
  const requestTimeoutMs = options.requestTimeoutMs ?? 30_000;

  return {
    async probe() {
      const version = spawn({ binaryPath, args: ["--version"] });
      let installed = false;
      try {
        const result = await withTimeout(version.exited, Math.min(requestTimeoutMs, 5_000), "codex --version");
        if (isMissing(version.spawnError()?.code)) return { installed: false };
        installed = result.code === 0;
      } catch {
        if (isMissing(version.spawnError()?.code)) return { installed: false };
        // The binary started but did not exit in time. Treat it as installed
        // and let the short app-server handshake below report auth.
        installed = true;
      } finally {
        await version.close();
      }
      if (!installed) return { installed: false };

      const child = spawn({ binaryPath, args: ["app-server"] });
      const rpc = createJsonRpc(child);
      const session = new CodexAppSession(rpc, child, idleOptions(requestTimeoutMs));
      session.bind();
      try {
        await rpc.request("initialize", CLIENT_INFO, requestTimeoutMs);
        rpc.notify("initialized", {});
        // refreshToken stays false so a probe cannot rotate credentials.
        // The account payload is reduced to a boolean and then discarded.
        const account = await rpc.request("account/read", { refreshToken: false }, requestTimeoutMs);
        const authed = readAuthed(account);
        let models: string[] | undefined;
        try {
          const listed = await rpc.request(
            "model/list",
            { limit: 50, includeHidden: false },
            Math.min(requestTimeoutMs, MODEL_LIST_PROBE_MS),
          );
          models = readModelIds(listed);
        } catch {
          models = undefined;
        }
        const result: ProbeResult = { installed: true, authed };
        if (models) result.models = models;
        return result;
      } catch {
        return { installed: true };
      } finally {
        await session.close();
      }
    },

    async open(opts) {
      const cwd = opts.cwd?.trim();
      if (!cwd) throw new CodexHarnessError("cwd is required");
      const executable = opts.binaryPath ?? binaryPath;
      const child = spawn({ binaryPath: executable, args: ["app-server"], cwd });
      const rpc = createJsonRpc(child);
      const session = new CodexAppSession(rpc, child, resolveOptions(opts, cwd, requestTimeoutMs));
      session.bind();
      try {
        await rpc.request("initialize", CLIENT_INFO, requestTimeoutMs);
        rpc.notify("initialized", {});
        return session;
      } catch (error) {
        await session.close();
        if (isMissing(child.spawnError()?.code)) {
          throw new CodexHarnessError(
            `Cannot find ${executable}. Install the Codex CLI or pass binaryPath.`,
            { cause: error },
          );
        }
        throw error;
      }
    },
  };
}

function idleOptions(requestTimeoutMs: number): ResolvedSessionOptions {
  return {
    cwd: process.cwd(),
    approvalPolicy: "never",
    sandbox: "read-only",
    sandboxPolicyType: "readOnly",
    autoApproval: "decline",
    requestTimeoutMs,
  };
}

function resolveOptions(opts: OpenSessionOptions, cwd: string, requestTimeoutMs: number): ResolvedSessionOptions {
  const sandbox = resolveSandbox(opts.sandboxPolicy ?? "workspace-write");
  return {
    cwd,
    model: opts.model?.trim() || undefined,
    approvalPolicy: resolveApproval(opts.approvalPolicy?.trim() || "on-request"),
    sandbox: sandbox.thread,
    sandboxPolicyType: sandbox.turn,
    autoApproval: opts.autoApproval ?? "decline",
    requestTimeoutMs,
  };
}

function resolveApproval(value: string): string {
  return APPROVAL[value as keyof typeof APPROVAL] ?? value;
}

function resolveSandbox(value: string): { thread: string; turn: string } {
  const known = SANDBOX[value as keyof typeof SANDBOX];
  if (known) return known;
  return { thread: value, turn: value };
}

function readAuthed(result: unknown): boolean {
  if (!isRecord(result)) return false;
  const account = result.account;
  if (isRecord(account) && typeof account.type === "string") return true;
  return result.requiresOpenaiAuth === false;
}

function readModelIds(result: unknown): string[] {
  if (!isRecord(result) || !Array.isArray(result.data)) return [];
  const ids: string[] = [];
  for (const entry of result.data) {
    const id = readString(entry, "id") ?? readString(entry, "model");
    if (id) ids.push(id);
  }
  return ids;
}

function isMissing(code: string | undefined): boolean {
  return code === "ENOENT" || code === "ENOTDIR";
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new CodexHarnessError(`${label} timed out after ${ms}ms`)), ms);
    timer.unref();
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}
