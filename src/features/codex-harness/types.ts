import type { CodexChild, CodexSpawnSpec } from "./process";

/** A trimmed adapter-shaped session over one `codex app-server` process. */
export interface CodexHarness {
  /**
   * Check that the CLI exists, then optionally handshake, read account status,
   * and list models. Does not start a thread.
   */
  probe(): Promise<ProbeResult>;
  open(options: OpenSessionOptions): Promise<CodexSession>;
}

export interface ProbeResult {
  installed: boolean;
  /** Present when `account/read` succeeded. Never includes account details. */
  authed?: boolean;
  /** Model ids from `model/list`, when that call succeeded. */
  models?: string[];
}

export interface OpenSessionOptions {
  cwd: string;
  model?: string;
  /** Executable used instead of `codex` on `PATH`. */
  binaryPath?: string;
  /**
   * Forwarded to `thread/start` and `turn/start`.
   * Current values are `never`, `onRequest`, and `unlessTrusted`.
   * Older aliases `on-request` and `untrusted` are normalized.
   * Defaults to `onRequest`.
   */
  approvalPolicy?: string;
  /**
   * Sandbox mode forwarded to `thread/start` and `turn/start`.
   * Accepts `read-only` / `readOnly`, `workspace-write` / `workspaceWrite`,
   * and `danger-full-access` / `dangerFullAccess`. Defaults to `workspace-write`.
   */
  sandboxPolicy?: string;
  /**
   * How to answer approval server-requests.
   * `decline` (default) and `accept` reply immediately so a turn cannot hang.
   * `manual` waits for `respondToApproval`.
   */
  autoApproval?: "accept" | "decline" | "manual";
}

export interface CodexSession {
  /** One consumer. Buffered until iterated, and closed by `close()`. */
  events: AsyncIterable<CodexEvent>;
  ensureThread(): Promise<{ threadId: string }>;
  /** Starts the thread first when `ensureThread` has not been called. */
  startTurn(input: string): Promise<{ turnId: string }>;
  interrupt(): Promise<void>;
  respondToApproval(requestId: string, decision: "accept" | "decline" | string): Promise<void>;
  close(): Promise<void>;
}

export type CodexEvent =
  | {
      type: "text.delta";
      itemId: string;
      delta: string;
      turnId?: string;
    }
  | {
      type: "tool.started";
      itemId: string;
      tool: string;
      turnId?: string;
      title?: string;
    }
  | {
      type: "tool.delta";
      itemId: string;
      delta: string;
      turnId?: string;
    }
  | {
      type: "tool.completed";
      itemId: string;
      tool: string;
      turnId?: string;
      status?: string;
    }
  | {
      type: "approval.request";
      requestId: string;
      method: string;
      threadId?: string;
      turnId?: string;
      itemId?: string;
      detail?: string;
    }
  | {
      type: "turn.end";
      turnId: string;
      status: string;
    }
  | {
      type: "error";
      message: string;
      turnId?: string;
    };

export interface CodexHarnessOptions {
  binaryPath?: string;
  /** Bounds each JSON-RPC request. The turn itself streams after `turn/start` returns. */
  requestTimeoutMs?: number;
  /** Test seam. Production spawns `binaryPath` with `child_process`. */
  spawn?: (spec: CodexSpawnSpec) => CodexChild;
}
