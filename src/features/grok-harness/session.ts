import type { CodexChild } from "@/features/codex-harness";
import { AsyncQueue } from "@/features/codex-harness/async-queue";
import { isRecord } from "@/lib/record";
import type { AcpPeer } from "./acp";
import { GrokHarnessError } from "./errors";
import type { GrokEvent, GrokSession } from "./types";

export interface GrokSessionConfig {
  cwd: string;
  permission: "reject" | "cancel";
  requestTimeoutMs: number;
  /** Runs after the process is closed, e.g. deleting the agent profile. */
  cleanup?: () => Promise<void>;
}

/** ACP `stopReason` → the Codex-style `turn.end` status the assistant layer expects. */
export function turnStatus(stopReason: unknown): string {
  if (stopReason === "end_turn") return "completed";
  if (stopReason === "cancelled") return "interrupted";
  return typeof stopReason === "string" && stopReason ? stopReason : "failed";
}

export class GrokAcpSession implements GrokSession {
  readonly events = new AsyncQueue<GrokEvent>();
  private sessionId: string | undefined;
  private creating: Promise<{ sessionId: string }> | undefined;
  private turnId: string | undefined;
  private turnSeq = 0;
  private closing: Promise<void> | undefined;

  constructor(
    private readonly rpc: AcpPeer,
    private readonly child: CodexChild,
    private readonly config: GrokSessionConfig,
  ) {}

  bind(): void {
    this.rpc.onNotification((method, params) => this.onNotification(method, params));
    this.rpc.onRequest((method, params) => this.onRequest(method, params));
    void this.rpc.closed.finally(() => this.events.close());
  }

  ensureSession(): Promise<{ sessionId: string }> {
    if (this.sessionId) return Promise.resolve({ sessionId: this.sessionId });
    this.creating ??= this.rpc
      .request("session/new", { cwd: this.config.cwd, mcpServers: [] }, this.config.requestTimeoutMs)
      .then((result) => {
        const id = isRecord(result) && typeof result.sessionId === "string" ? result.sessionId : undefined;
        if (!id) throw new GrokHarnessError("session/new returned no sessionId");
        this.sessionId = id;
        return { sessionId: id };
      })
      .catch((error: unknown) => {
        this.creating = undefined;
        throw error;
      });
    return this.creating;
  }

  async startTurn(input: string): Promise<{ turnId: string }> {
    const { sessionId } = await this.ensureSession();
    if (this.turnId) throw new GrokHarnessError("a Grok turn is already running");
    this.turnSeq += 1;
    const turnId = `${sessionId}:${this.turnSeq}`;
    this.turnId = turnId;
    const prompt = this.rpc.request("session/prompt", { sessionId, prompt: [{ type: "text", text: input }] });
    prompt.then(
      (result) => {
        this.turnId = undefined;
        this.events.push({ type: "turn.end", turnId, status: turnStatus(isRecord(result) ? result.stopReason : undefined) });
      },
      (error: unknown) => {
        this.turnId = undefined;
        this.events.push({ type: "error", turnId, message: error instanceof Error ? error.message : String(error) });
        this.events.push({ type: "turn.end", turnId, status: "failed" });
      },
    );
    return { turnId };
  }

  async interrupt(): Promise<void> {
    if (!this.sessionId || !this.turnId) throw new GrokHarnessError("no Grok turn is running");
    this.rpc.notify("session/cancel", { sessionId: this.sessionId });
  }

  close(): Promise<void> {
    this.closing ??= (async () => {
      try {
        await this.child.close();
      } finally {
        this.events.close();
        await this.config.cleanup?.().catch(() => undefined);
      }
    })();
    return this.closing;
  }

  private onNotification(method: string, params: unknown): void {
    if (method !== "session/update" || !isRecord(params)) return;
    if (this.sessionId && params.sessionId !== undefined && params.sessionId !== this.sessionId) return;
    const update = params.update;
    if (!isRecord(update)) return;
    const turnId = this.turnId;
    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        const content = update.content;
        const text = isRecord(content) && content.type === "text" && typeof content.text === "string" ? content.text : "";
        if (text) this.events.push({ type: "text.delta", itemId: turnId ?? "message", delta: text, turnId });
        return;
      }
      case "tool_call": {
        const id = typeof update.toolCallId === "string" ? update.toolCallId : "tool";
        const title = typeof update.title === "string" ? update.title : undefined;
        this.events.push({ type: "tool.started", itemId: id, tool: toolName(update) ?? title ?? "tool", title, turnId });
        return;
      }
      case "tool_call_update": {
        const status = typeof update.status === "string" ? update.status : undefined;
        if (status !== "completed" && status !== "failed") return;
        const id = typeof update.toolCallId === "string" ? update.toolCallId : "tool";
        this.events.push({ type: "tool.completed", itemId: id, tool: toolName(update) ?? "tool", status, turnId });
        return;
      }
      default:
        return; // thoughts, plans, command lists, session info
    }
  }

  private onRequest(method: string, params: unknown): unknown {
    if (method !== "session/request_permission") {
      throw new GrokHarnessError(`Method not found: ${method}`, { code: -32601 });
    }
    const request = isRecord(params) ? params : {};
    const toolCall = isRecord(request.toolCall) ? request.toolCall : {};
    const requestId = typeof toolCall.toolCallId === "string" ? toolCall.toolCallId : `permission-${Date.now()}`;
    this.events.push({
      type: "approval.request",
      requestId,
      method,
      turnId: this.turnId,
      itemId: requestId,
      detail: typeof toolCall.title === "string" ? toolCall.title : undefined,
    });
    if (this.config.permission === "reject") {
      const options = Array.isArray(request.options) ? request.options.filter(isRecord) : [];
      const reject =
        options.find((option) => option.kind === "reject_once") ??
        options.find((option) => typeof option.kind === "string" && option.kind.startsWith("reject"));
      if (reject && typeof reject.optionId === "string") {
        return { outcome: { outcome: "selected", optionId: reject.optionId } };
      }
    }
    return { outcome: { outcome: "cancelled" } };
  }
}

function toolName(update: Record<string, unknown>): string | undefined {
  const meta = update._meta;
  if (!isRecord(meta)) return undefined;
  const tool = meta["x.ai/tool"];
  return isRecord(tool) && typeof tool.name === "string" ? tool.name : undefined;
}
