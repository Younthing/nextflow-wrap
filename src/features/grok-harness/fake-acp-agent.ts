import { AsyncQueue } from "@/features/codex-harness/async-queue";
import type { CodexChild, CodexChildExit, CodexSpawnSpec } from "@/features/codex-harness/process";

/** One JSON-RPC 2.0 frame as written by either side. */
export interface AcpWire {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code?: number; message?: string };
}

export interface FakeAcpScript {
  /** `grok --version` exit code. Default 0. */
  versionCode?: number;
  /** Simulate a missing binary (ENOENT) for every spawn. */
  missing?: boolean;
  /** `session/new` answers `-32000 Authentication required`. */
  unauthenticated?: boolean;
  /** Text chunks streamed for each `session/prompt`. */
  chunks?: string[];
  /** Ask `session/request_permission` before replying, and record the answer. */
  askPermission?: boolean;
  /** Wait for `session/cancel` before ending the prompt. */
  holdUntilCancel?: boolean;
  /** Send an agent → client request the client does not implement. */
  unknownRequest?: string;
}

/**
 * In-memory `grok agent stdio` peer for unit tests. Speaks NDJSON JSON-RPC 2.0
 * like the real agent: `initialize` → `session/new` → `session/prompt`, with
 * `session/update` notifications and `session/request_permission` requests.
 */
export class FakeAcpAgent implements CodexChild {
  readonly received: AcpWire[] = [];
  readonly sent: AcpWire[] = [];
  readonly exited: Promise<CodexChildExit>;
  private readonly stdout = new AsyncQueue<string>();
  private resolveExit!: (value: CodexChildExit) => void;
  private done = false;
  private nextServerId = 1000;
  private readonly waiting = new Map<number, (frame: AcpWire) => void>();
  private cancelled: (() => void) | undefined;
  private readonly sessionId = "sess-1";

  constructor(readonly spec: CodexSpawnSpec, private readonly script: FakeAcpScript) {
    this.exited = new Promise((resolve) => {
      this.resolveExit = resolve;
    });
    if (spec.args[0] === "--version") {
      queueMicrotask(() => this.exit(script.versionCode ?? 0));
    }
  }

  writeLine(line: string): void {
    if (this.done) throw new Error("stdin closed");
    const frame = JSON.parse(line) as AcpWire;
    this.received.push(frame);
    void this.handle(frame);
  }

  lines(): AsyncIterable<string> {
    return this.stdout;
  }

  stderrTail(): string {
    return "";
  }

  spawnError(): NodeJS.ErrnoException | undefined {
    if (!this.script.missing) return undefined;
    const error = new Error("spawn grok ENOENT") as NodeJS.ErrnoException;
    error.code = "ENOENT";
    return error;
  }

  async close(): Promise<void> {
    this.exit(null);
  }

  private exit(code: number | null): void {
    if (this.done) return;
    this.done = true;
    this.stdout.close();
    this.resolveExit({ code, signal: null });
  }

  private send(frame: AcpWire): void {
    if (this.done) return;
    const wire = { jsonrpc: "2.0", ...frame };
    this.sent.push(wire);
    this.stdout.push(JSON.stringify(wire));
  }

  private ask(method: string, params: Record<string, unknown>): Promise<AcpWire> {
    const id = this.nextServerId++;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.send({ id, method, params });
    });
  }

  private update(update: Record<string, unknown>): void {
    this.send({ method: "session/update", params: { sessionId: this.sessionId, update } });
  }

  private async handle(frame: AcpWire): Promise<void> {
    if (frame.method === undefined && typeof frame.id === "number") {
      this.waiting.get(frame.id)?.(frame);
      this.waiting.delete(frame.id);
      return;
    }
    switch (frame.method) {
      case "initialize":
        this.send({
          id: frame.id,
          result: {
            protocolVersion: 1,
            agentCapabilities: {},
            authMethods: [{ id: "cached_token" }],
            _meta: { modelState: { currentModelId: "grok-test", availableModels: [{ modelId: "grok-test" }, { modelId: "grok-fast" }] } },
          },
        });
        return;
      case "session/new":
        if (this.script.unauthenticated) {
          this.send({ id: frame.id, error: { code: -32000, message: "Authentication required" } });
          return;
        }
        this.send({ id: frame.id, result: { sessionId: this.sessionId } });
        return;
      case "session/close":
        this.send({ id: frame.id, result: {} });
        return;
      case "session/cancel":
        this.cancelled?.();
        return;
      case "session/prompt":
        await this.prompt(frame);
        return;
      default:
        if (frame.id !== undefined) this.send({ id: frame.id, error: { code: -32601, message: "Method not found" } });
    }
  }

  private async prompt(frame: AcpWire): Promise<void> {
    this.update({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "thinking" } });
    if (this.script.unknownRequest) await this.ask(this.script.unknownRequest, { path: "/etc/hosts" });
    if (this.script.askPermission) {
      this.update({ sessionUpdate: "tool_call", toolCallId: "call-1", title: "run_terminal_command", _meta: { "x.ai/tool": { name: "run_terminal_command" } } });
      await this.ask("session/request_permission", {
        sessionId: this.sessionId,
        toolCall: { toolCallId: "call-1", title: "Execute `rm -rf /`" },
        options: [
          { optionId: "allow", kind: "allow_once", name: "Allow" },
          { optionId: "deny", kind: "reject_once", name: "Reject" },
        ],
      });
      this.update({ sessionUpdate: "tool_call_update", toolCallId: "call-1", status: "failed" });
    }
    for (const text of this.script.chunks ?? []) {
      this.update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text } });
    }
    if (this.script.holdUntilCancel) {
      await new Promise<void>((resolve) => {
        this.cancelled = resolve;
      });
      this.send({ id: frame.id, result: { stopReason: "cancelled" } });
      return;
    }
    this.send({ id: frame.id, result: { stopReason: "end_turn" } });
  }
}
