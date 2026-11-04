import type { CodexChild, CodexSpawnSpec } from "@/features/codex-harness";

/** A thin session over one `grok agent stdio` (ACP) process. */
export interface GrokHarness {
  /**
   * Check that `grok` exists, then handshake and open (but never prompt) one
   * session in an empty temp directory. `session/new` answering
   * `Authentication required` is the logged-out signal. Never reads `~/.grok`.
   */
  probe(): Promise<GrokProbeResult>;
  open(options: GrokOpenOptions): Promise<GrokSession>;
}

export interface GrokProbeResult {
  installed: boolean;
  /** Present when `session/new` answered. Never includes account details. */
  authed?: boolean;
  /** Model ids advertised by `initialize`, when present. */
  models?: string[];
}

export interface GrokOpenOptions {
  cwd: string;
  /** Passed as `grok agent --model`. Omit to use the CLI default. */
  model?: string;
  /** Executable used instead of `grok` on `PATH`. */
  binaryPath?: string;
  /**
   * How to answer `session/request_permission`.
   * `reject` (default) picks the agent's reject option so a turn cannot hang
   * and the tool does not run. `cancel` answers with the cancelled outcome.
   */
  permission?: "reject" | "cancel";
}

export interface GrokSession {
  /** One consumer. Buffered until iterated, and closed by `close()` or process exit. */
  events: AsyncIterable<GrokEvent>;
  ensureSession(): Promise<{ sessionId: string }>;
  /**
   * Sends `session/prompt` and resolves once it is written. The turn streams on
   * `events` and ends with `turn.end` when the prompt request returns.
   */
  startTurn(input: string): Promise<{ turnId: string }>;
  /** Sends `session/cancel`. The turn then ends with status `interrupted`. */
  interrupt(): Promise<void>;
  close(): Promise<void>;
}

/** A subset of the Codex harness event shape, so the assistant turn layer can consume either. */
export type GrokEvent =
  | { type: "text.delta"; itemId: string; delta: string; turnId?: string }
  | { type: "tool.started"; itemId: string; tool: string; turnId?: string; title?: string }
  | { type: "tool.completed"; itemId: string; tool: string; turnId?: string; status?: string }
  | {
      type: "approval.request";
      requestId: string;
      method: string;
      turnId?: string;
      itemId?: string;
      detail?: string;
    }
  | { type: "turn.end"; turnId: string; status: string }
  | { type: "error"; message: string; turnId?: string };

export interface GrokHarnessOptions {
  binaryPath?: string;
  /** Bounds `initialize` and `session/new`. The prompt itself streams without a deadline. */
  requestTimeoutMs?: number;
  /**
   * Grok sandbox profile (`GROK_SANDBOX`) for every process this harness starts.
   * Defaults to `strict`: reads limited to the cwd, system paths and `~/.grok`,
   * writes to the cwd and temp, child network blocked on Linux.
   */
  sandbox?: string;
  /** Base environment for the child. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Test seam. Production spawns `binaryPath` with `child_process`. */
  spawn?: (spec: CodexSpawnSpec) => CodexChild;
}
