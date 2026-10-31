import { AsyncQueue } from "./async-queue";
import { CodexHarnessError } from "./errors";
import type { JsonRpcConnection, JsonRpcNotification, JsonRpcServerRequest } from "./jsonrpc";
import type { CodexChild } from "./process";
import { isRecord, readString } from "./record";
import type { CodexEvent, CodexSession } from "./types";

export interface ResolvedSessionOptions {
  cwd: string;
  model?: string;
  approvalPolicy: string;
  /** `thread/start` sandbox mode (`read-only`, `workspace-write`, `danger-full-access`). */
  sandbox: string;
  /** `turn/start` sandboxPolicy.type (`readOnly`, `workspaceWrite`, `dangerFullAccess`). */
  sandboxPolicyType: string;
  autoApproval: "accept" | "decline" | "manual";
  requestTimeoutMs: number;
}

const TOOL_ITEMS = new Set([
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "dynamicToolCall",
  "webSearch",
  "collabToolCall",
  "collabAgentToolCall",
]);

const APPROVAL_METHODS = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
  "item/tool/requestUserInput",
  "tool/requestUserInput",
  "mcpServer/elicitation/request",
]);

interface PendingApproval {
  id: string | number;
  method: string;
}

export class CodexAppSession implements CodexSession {
  readonly events: AsyncIterable<CodexEvent>;
  private readonly queue = new AsyncQueue<CodexEvent>();
  private readonly approvals = new Map<string, PendingApproval>();
  private threadId: string | undefined;
  private threadStart: Promise<{ threadId: string }> | undefined;
  private activeTurnId: string | undefined;
  private closed = false;
  private closing: Promise<void> | undefined;

  constructor(
    private readonly rpc: JsonRpcConnection,
    private readonly child: CodexChild,
    private readonly options: ResolvedSessionOptions,
  ) {
    this.events = this.queue;
  }

  async ensureThread(): Promise<{ threadId: string }> {
    this.assertOpen();
    if (this.threadId) return { threadId: this.threadId };
    this.threadStart ??= this.openThread();
    return this.threadStart;
  }

  async startTurn(input: string): Promise<{ turnId: string }> {
    this.assertOpen();
    const text = input.trim();
    if (!text) throw new CodexHarnessError("turn input is empty");
    const { threadId } = await this.ensureThread();
    const params: Record<string, unknown> = {
      threadId,
      input: [{ type: "text", text }],
      cwd: this.options.cwd,
      approvalPolicy: this.options.approvalPolicy,
      sandboxPolicy: { type: this.options.sandboxPolicyType },
    };
    if (this.options.model) params.model = this.options.model;
    const result = await this.rpc.request("turn/start", params, this.options.requestTimeoutMs);
    const turnId = readString(isRecord(result) ? result.turn : undefined, "id");
    if (!turnId) throw new CodexHarnessError("turn/start returned no turn id");
    this.activeTurnId = turnId;
    return { turnId };
  }

  async interrupt(): Promise<void> {
    this.assertOpen();
    if (!this.threadId || !this.activeTurnId) throw new CodexHarnessError("no active turn to interrupt");
    await this.rpc.request(
      "turn/interrupt",
      { threadId: this.threadId, turnId: this.activeTurnId },
      this.options.requestTimeoutMs,
    );
  }

  async respondToApproval(requestId: string, decision: string): Promise<void> {
    this.assertOpen();
    const pending = this.approvals.get(requestId);
    if (!pending) throw new CodexHarnessError(`no pending approval ${requestId}`);
    const resolved = decision.trim();
    if (!resolved) throw new CodexHarnessError("approval decision is empty");
    this.approvals.delete(requestId);
    this.rpc.respond(pending.id, approvalResult(pending.method, resolved));
  }

  close(): Promise<void> {
    this.closing ??= this.shutdown();
    return this.closing;
  }

  private async shutdown(): Promise<void> {
    this.closed = true;
    this.approvals.clear();
    this.rpc.close();
    await this.child.close();
    this.queue.close();
  }

  bind(): void {
    this.rpc.start({
      onNotification: (message) => this.onNotification(message),
      onServerRequest: (message) => this.onServerRequest(message),
      onProtocolError: (message) => this.queue.push({ type: "error", message }),
      onUnexpectedClose: (error) => this.onUnexpectedClose(error),
    });
  }

  private async openThread(): Promise<{ threadId: string }> {
    try {
      const params: Record<string, unknown> = {
        cwd: this.options.cwd,
        approvalPolicy: this.options.approvalPolicy,
        sandbox: this.options.sandbox,
        serviceName: "nextflow-wrap",
      };
      if (this.options.model) params.model = this.options.model;
      const result = await this.rpc.request("thread/start", params, this.options.requestTimeoutMs);
      const threadId = readString(isRecord(result) ? result.thread : undefined, "id");
      if (!threadId) throw new CodexHarnessError("thread/start returned no thread id");
      this.threadId = threadId;
      return { threadId };
    } catch (error) {
      this.threadStart = undefined;
      throw error;
    }
  }

  private onNotification(message: JsonRpcNotification): void {
    if (message.method === "turn/started") {
      const turnId = readString(isRecord(message.params) ? message.params.turn : undefined, "id");
      if (turnId) this.activeTurnId = turnId;
    }
    for (const event of mapNotification(message.method, message.params)) {
      if (event.type === "turn.end" && event.turnId === this.activeTurnId) this.activeTurnId = undefined;
      this.queue.push(event);
    }
  }

  private onServerRequest(request: JsonRpcServerRequest): void {
    if (this.closed) return;
    const requestId = String(request.id);
    if (!APPROVAL_METHODS.has(request.method)) {
      this.queue.push({ type: "error", message: `Unsupported codex server request ${request.method}` });
      this.rpc.respondError(request.id, { code: -32601, message: `Method not found: ${request.method}` });
      return;
    }
    const params = isRecord(request.params) ? request.params : {};
    const detail = approvalDetail(params);
    this.queue.push({
      type: "approval.request",
      requestId,
      method: request.method,
      ...(typeof params.threadId === "string" ? { threadId: params.threadId } : {}),
      ...(typeof params.turnId === "string" ? { turnId: params.turnId } : {}),
      ...(typeof params.itemId === "string" ? { itemId: params.itemId } : {}),
      ...(detail ? { detail } : {}),
    });
    if (this.options.autoApproval === "manual") {
      this.approvals.set(requestId, { id: request.id, method: request.method });
      return;
    }
    this.rpc.respond(request.id, approvalResult(request.method, this.options.autoApproval));
  }

  private onUnexpectedClose(error: CodexHarnessError): void {
    if (this.closed) return;
    const tail = diagnosticTail(this.child.stderrTail());
    const message = tail ? `${error.message}\n${tail}` : error.message;
    this.queue.push({ type: "error", message });
    void this.close();
  }

  private assertOpen(): void {
    if (this.closed) throw new CodexHarnessError("codex session is closed");
  }
}

function mapNotification(method: string, params: unknown): CodexEvent[] {
  const record = isRecord(params) ? params : {};
  const turnId = readString(record, "turnId") ?? readString(record.turn, "id");

  if (method === "item/agentMessage/delta") {
    const delta = typeof record.delta === "string" ? record.delta : undefined;
    if (delta === undefined) return [];
    return [{
      type: "text.delta",
      itemId: readString(record, "itemId") ?? "",
      delta,
      ...(turnId ? { turnId } : {}),
    }];
  }

  if (method === "item/commandExecution/outputDelta" || method === "item/fileChange/outputDelta") {
    const delta = typeof record.delta === "string" ? record.delta : undefined;
    if (delta === undefined) return [];
    return [{
      type: "tool.delta",
      itemId: readString(record, "itemId") ?? "",
      delta,
      ...(turnId ? { turnId } : {}),
    }];
  }

  if (method === "item/started" || method === "item/completed") {
    const item = isRecord(record.item) ? record.item : undefined;
    const tool = item && typeof item.type === "string" ? item.type : undefined;
    if (!item || !tool || !TOOL_ITEMS.has(tool)) return [];
    const itemId = typeof item.id === "string" ? item.id : "";
    const title = toolTitle(item);
    if (method === "item/started") {
      return [{
        type: "tool.started",
        itemId,
        tool,
        ...(turnId ? { turnId } : {}),
        ...(title ? { title } : {}),
      }];
    }
    const status = typeof item.status === "string" ? item.status : undefined;
    return [{
      type: "tool.completed",
      itemId,
      tool,
      ...(turnId ? { turnId } : {}),
      ...(status ? { status } : {}),
    }];
  }

  if (method === "turn/completed") {
    const turn = isRecord(record.turn) ? record.turn : undefined;
    const completedId = readString(turn, "id") ?? turnId;
    if (!completedId) return [];
    const status = readString(turn, "status") ?? "completed";
    const errorMessage = turn && isRecord(turn.error) ? readString(turn.error, "message") : undefined;
    const events: CodexEvent[] = [];
    if (errorMessage) events.push({ type: "error", message: errorMessage, turnId: completedId });
    events.push({ type: "turn.end", turnId: completedId, status });
    return events;
  }

  if (method === "error") {
    // A retrying stream error is not the end of the turn. `turn/completed` is.
    if (record.willRetry === true) return [];
    const nested = isRecord(record.error) ? record.error : undefined;
    const message = nested ? readString(nested, "message") : undefined;
    return [{ type: "error", message: message ?? "codex error", ...(turnId ? { turnId } : {}) }];
  }

  return [];
}

function toolTitle(item: Record<string, unknown>): string | undefined {
  if (typeof item.command === "string") return item.command.slice(0, 500);
  if (typeof item.tool === "string") return item.tool;
  if (typeof item.query === "string") return item.query.slice(0, 500);
  return undefined;
}

/** Drop lines that may echo credentials. This client never reads `~/.codex`. */
function diagnosticTail(stderr: string): string {
  const kept = stderr
    .split("\n")
    .filter((line) => !/auth\.json|access_token|refresh_token|bearer\s+|sk-[a-z0-9_-]{8,}/i.test(line))
    .join("\n")
    .trim();
  return kept.slice(-500);
}

function approvalDetail(params: Record<string, unknown>): string | undefined {
  if (typeof params.command === "string") return params.command.slice(0, 500);
  if (typeof params.reason === "string") return params.reason.slice(0, 500);
  return undefined;
}

/**
 * Command and file approvals use `{ decision }`.
 * Other server requests get a non-hanging refusal payload.
 */
function approvalResult(method: string, decision: string): unknown {
  if (method === "item/permissions/requestApproval") return { permissions: {} };
  if (method === "item/tool/requestUserInput" || method === "tool/requestUserInput") return { answers: {} };
  if (method.startsWith("mcpServer/elicitation")) {
    return { action: decision === "accept" ? "accept" : "decline", content: null };
  }
  return { decision };
}
