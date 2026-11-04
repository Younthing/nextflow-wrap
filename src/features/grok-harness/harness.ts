import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CodexChild, CodexSpawnSpec } from "@/features/codex-harness";
import { spawnCodexChild } from "@/features/codex-harness/process";
import { isRecord } from "@/lib/record";
import { createAcpPeer } from "./acp";
import { GrokHarnessError } from "./errors";
import { writeChatProfile } from "./profile";
import { GrokAcpSession } from "./session";
import type { GrokHarness, GrokHarnessOptions, GrokProbeResult } from "./types";

export const ACP_PROTOCOL_VERSION = 1;

/** Client capabilities: no fs or terminal, so Grok cannot ask this process to touch files. */
export const CLIENT_CAPABILITIES = {
  fs: { readTextFile: false, writeTextFile: false },
  terminal: false,
} as const;

export const DEFAULT_GROK_SANDBOX = "strict";

/**
 * `grok agent` flags for every chat process.
 * No `--always-approve`: permission prompts are answered `reject`.
 * `--no-leader` keeps the agent in-process, which a non-`off` sandbox requires.
 */
export function agentArgs(profilePath: string, model?: string): string[] {
  const args = ["agent", "--no-leader", "--agent-profile", profilePath];
  if (model) args.push("--model", model);
  args.push("stdio");
  return args;
}

export function createGrokHarness(options: GrokHarnessOptions = {}): GrokHarness {
  const spawn = options.spawn ?? spawnCodexChild;
  const binaryPath = options.binaryPath?.trim() || "grok";
  const requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  const sandbox = options.sandbox?.trim() || DEFAULT_GROK_SANDBOX;
  const childEnv = (): NodeJS.ProcessEnv => ({ ...(options.env ?? process.env), GROK_SANDBOX: sandbox });

  async function start(executable: string, cwd: string, model?: string) {
    const profile = await writeChatProfile();
    let child: CodexChild;
    try {
      const spec: CodexSpawnSpec = { binaryPath: executable, args: agentArgs(profile.path, model), cwd, env: childEnv() };
      child = spawn(spec);
    } catch (error) {
      await profile.remove();
      throw error;
    }
    const rpc = createAcpPeer(child);
    let initialized: unknown;
    try {
      initialized = await rpc.request(
        "initialize",
        { protocolVersion: ACP_PROTOCOL_VERSION, clientCapabilities: CLIENT_CAPABILITIES },
        requestTimeoutMs,
      );
    } catch (error) {
      await child.close();
      await profile.remove();
      if (isMissing(child.spawnError()?.code)) {
        throw new GrokHarnessError(`Cannot find ${executable}. Install Grok Build or set GROK_BIN.`, { cause: error });
      }
      throw error;
    }
    return { child, rpc, profile, initialized };
  }

  return {
    async probe() {
      const version = spawn({ binaryPath, args: ["--version"], env: childEnv() });
      let installed = false;
      try {
        const result = await withTimeout(version.exited, Math.min(requestTimeoutMs, 5_000), "grok --version");
        if (isMissing(version.spawnError()?.code)) return { installed: false };
        installed = result.code === 0;
      } catch {
        if (isMissing(version.spawnError()?.code)) return { installed: false };
        installed = true;
      } finally {
        await version.close();
      }
      if (!installed) return { installed: false };

      const cwd = await mkdtemp(join(tmpdir(), "nextflow-grok-probe-"));
      let opened: Awaited<ReturnType<typeof start>> | undefined;
      try {
        opened = await start(binaryPath, cwd);
        const models = readModelIds(opened.initialized);
        const result: GrokProbeResult = { installed: true };
        if (models.length > 0) result.models = models;
        try {
          // Creates (never prompts) a session. Costs no tokens.
          const created = await opened.rpc.request("session/new", { cwd, mcpServers: [] }, requestTimeoutMs);
          result.authed = true;
          await closeAcpSession(opened.rpc, created);
        } catch (error) {
          if (isAuthRequired(error)) result.authed = false;
        }
        return result;
      } catch {
        return { installed: true };
      } finally {
        await opened?.child.close();
        await opened?.profile.remove();
        await rm(cwd, { recursive: true, force: true }).catch(() => undefined);
      }
    },

    async open(opts) {
      const cwd = opts.cwd?.trim();
      if (!cwd) throw new GrokHarnessError("cwd is required");
      const { child, rpc, profile } = await start(opts.binaryPath ?? binaryPath, cwd, opts.model?.trim() || undefined);
      const session = new GrokAcpSession(rpc, child, {
        cwd,
        permission: opts.permission ?? "reject",
        requestTimeoutMs,
        cleanup: profile.remove,
      });
      session.bind();
      return session;
    },
  };
}

/** Best-effort `session/close` so probes do not leave resident sessions behind. */
async function closeAcpSession(rpc: { request(method: string, params: unknown, timeoutMs?: number): Promise<unknown> }, created: unknown) {
  const sessionId = isRecord(created) && typeof created.sessionId === "string" ? created.sessionId : undefined;
  if (!sessionId) return;
  await rpc.request("session/close", { sessionId }, 1_000).catch(() => undefined);
}

/** ACP `-32000 Authentication required`, or any error that names auth. */
export function isAuthRequired(error: unknown): boolean {
  if (!(error instanceof GrokHarnessError)) return false;
  if (error.code === -32000 && /auth/i.test(error.message)) return true;
  return /authentication required|not authenticated|unauthori[sz]ed/i.test(error.message);
}

function readModelIds(result: unknown): string[] {
  if (!isRecord(result) || !isRecord(result._meta)) return [];
  const state = result._meta.modelState;
  if (!isRecord(state) || !Array.isArray(state.availableModels)) return [];
  const ids: string[] = [];
  for (const entry of state.availableModels) {
    if (isRecord(entry) && typeof entry.modelId === "string") ids.push(entry.modelId);
  }
  return ids;
}

function isMissing(code: string | undefined): boolean {
  return code === "ENOENT" || code === "ENOTDIR";
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new GrokHarnessError(`${label} timed out after ${ms}ms`)), ms);
    timer.unref();
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}
