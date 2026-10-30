import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CodexEvent, CodexHarness, CodexSession } from "@/features/codex-harness";
import type { SessionPermit } from "./session-limit";

/** AG-UI events this adapter emits. CopilotKit adds run start and run finish. */
export type CodexAguiEvent =
  | { type: "TEXT_MESSAGE_CHUNK"; role: "assistant"; messageId: string; delta: string }
  | { type: "TOOL_CALL_START"; toolCallId: string; toolCallName: string; parentMessageId: string }
  | { type: "TOOL_CALL_ARGS"; toolCallId: string; delta: string }
  | { type: "TOOL_CALL_END"; toolCallId: string };

export interface PromptMessage {
  role: string;
  content?: unknown;
  toolCallId?: string;
  toolCalls?: { id: string; function: { name: string; arguments: string } }[];
}

export interface PromptTool {
  name: string;
  description: string;
  parameters?: unknown;
}

export interface PromptInput {
  messages: PromptMessage[];
  context?: { description: string; value: string }[];
  tools?: PromptTool[];
  state?: unknown;
}

/** Same budget as the built-in agent's `maxSteps`. One model reply counts as one step. */
export const ASSISTANT_MAX_STEPS = 12;

const MIXED_TOOL_MESSAGE = "工具调用被拒绝：整段回复只能是一个 JSON 对象，不能在 JSON 前后附加说明。这次没有执行工具。";

export class CodexTurnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexTurnError";
  }
}

function toolInstructions(maxSteps: number): string {
  return [
    "需要调用工具时，不要写别的文字，只回复一个 JSON 对象（不要用 markdown）：",
    "{\"tool\":\"工具名\",\"arguments\":{}}",
    "一次只调用一个工具。整段回复只能是这个 JSON 对象；前后如果还有说明，这次调用会被拒绝，不会执行。",
    `这一轮最多调用 ${maxSteps} 次工具。工具结果会在下一条对话里出现。不需要工具时用普通中文回答，不要输出 JSON。`,
    "画布和运行记录只能通过这些工具修改。不要用 shell 或改文件来代替工具。",
  ].join("\n");
}

export function renderCodexPrompt(system: string, input: PromptInput, maxSteps = ASSISTANT_MAX_STEPS): string {
  const steps = resolveMaxSteps(maxSteps);
  const parts = [system.trim()];
  if (input.context && input.context.length > 0) {
    parts.push("## 应用上下文");
    for (const item of input.context) parts.push(`${item.description}:\n${item.value}`);
  }
  if (hasState(input.state)) {
    parts.push(`## 应用状态\n${JSON.stringify(input.state)}`);
  }
  if (input.tools && input.tools.length > 0) {
    parts.push("## 工具");
    parts.push(toolInstructions(steps));
    for (const tool of input.tools) {
      parts.push(`- ${tool.name}: ${tool.description}\n  参数: ${safeJson(tool.parameters ?? {})}`);
    }
  }
  parts.push("## 对话");
  for (const message of input.messages) {
    const line = renderMessage(message);
    if (line) parts.push(line);
  }
  return parts.join("\n\n");
}

/**
 * Model replies since the latest user message. Tool results count when the
 * client omits the assistant tool-call message. The two are not added together.
 */
export function assistantStepsUsed(messages: readonly PromptMessage[]): number {
  let modelTurns = 0;
  let toolResults = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user") break;
    if (message.role === "tool") {
      toolResults += 1;
      continue;
    }
    if (message.role !== "assistant") continue;
    const calls = message.toolCalls?.length ?? 0;
    modelTurns += calls > 0 ? calls : 1;
  }
  return Math.max(modelTurns, toolResults);
}

export interface ParsedToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * A tool reply is the whole message, optionally wrapped in one json fence.
 *
 * Prose before or after a tool JSON object is rejected and is not executed.
 * Extracting a trailing object would hide the model's words and could run a
 * tool the surrounding text did not commit to. The model can send JSON only
 * on the next step, and the step cap bounds those retries.
 */
export function parseToolReply(raw: string, toolNames: readonly string[]): ParsedToolCall | undefined {
  const trimmed = unwrapFence(raw.trim().replace(/^\uFEFF/, ""));
  if (!trimmed) return undefined;
  const spans = toolSpans(trimmed);
  if (spans.length === 0) return undefined;
  const [span] = spans;
  const pure = spans.length === 1 && span.start === 0 && span.end === trimmed.length;
  if (!pure || !span) throw new CodexTurnError(MIXED_TOOL_MESSAGE);
  const name = clipName(span.name);
  if (!toolNames.includes(span.name)) {
    const known = toolNames.length > 0 ? toolNames.join("、") : "（当前没有已注册的工具）";
    throw new CodexTurnError(`未知工具「${name}」。只能使用：${known}`);
  }
  const args = readArguments(span.arguments);
  if (!args) throw new CodexTurnError(`工具「${name}」的 arguments 必须是 JSON 对象`);
  return { name: span.name, arguments: args };
}

export async function* interpretCodexEvents(
  events: AsyncIterable<CodexEvent>,
  toolNames: readonly string[],
  newId: () => string = () => crypto.randomUUID(),
): AsyncGenerator<CodexAguiEvent> {
  let raw = "";
  let streamed = false;
  let failure: string | undefined;
  let ended = false;
  const messageId = newId();
  for await (const event of events) {
    if (event.type === "text.delta") {
      raw += event.delta;
      if (!streamed && shouldStream(raw)) {
        streamed = true;
        yield textEvent(messageId, raw);
      } else if (streamed) {
        yield textEvent(messageId, event.delta);
      }
      continue;
    }
    if (event.type === "error") {
      failure = event.message;
      continue;
    }
    if (event.type === "turn.end") {
      ended = true;
      if (event.status !== "completed") throw new Error(failure ?? `Codex 回合结束：${event.status}`);
      break;
    }
  }
  if (!ended) throw new Error(failure ?? "Codex 会话在回合结束前关闭了");
  const call = parseToolReply(raw, toolNames);
  if (call) {
    if (streamed) throw new CodexTurnError(MIXED_TOOL_MESSAGE);
    const toolCallId = newId();
    const args = JSON.stringify(call.arguments);
    yield { type: "TOOL_CALL_START", toolCallId, toolCallName: call.name, parentMessageId: messageId };
    yield { type: "TOOL_CALL_ARGS", toolCallId, delta: args };
    yield { type: "TOOL_CALL_END", toolCallId };
    return;
  }
  if (streamed) return;
  if (raw) yield textEvent(messageId, raw);
}

export interface CodexAssistantRun {
  harness: CodexHarness;
  prompt: string;
  /** Set only in tests. A chat run omits this and gets an empty temp directory. */
  cwd?: string;
  model?: string;
  maxSteps?: number;
  signal?: AbortSignal;
  /** When set, Codex starts only if this request still owns the session slot. */
  permit?: SessionPermit;
}

/** One CopilotKit run: a short-lived Codex thread, then AG-UI text or one tool call. */
export async function* runCodexAssistant(input: PromptInput, options: CodexAssistantRun): AsyncGenerator<CodexAguiEvent> {
  const claimed = options.permit?.claim() ?? false;
  const maxSteps = resolveMaxSteps(options.maxSteps);
  let session: CodexSession | undefined;
  let workspace: { cwd: string; remove: () => Promise<void> } | undefined;
  let turnReady = false;
  let sawAbort = false;
  const stop = () => {
    const current = session;
    if (!current) return;
    const cancel = turnReady
      ? current.interrupt().catch(() => current.close())
      : current.close();
    void cancel;
  };
  const onAbort = () => {
    sawAbort = true;
    stop();
  };
  options.signal?.addEventListener("abort", onAbort);
  const aborted = () => sawAbort || options.signal?.aborted === true;
  try {
    if (options.permit && !claimed) throw new CodexTurnError("请求已结束");
    if (assistantStepsUsed(input.messages) >= maxSteps) {
      throw new CodexTurnError(`已达到这一轮的步数上限（${maxSteps}），已停止继续调用模型。请把任务拆开后重新发送。`);
    }
    if (aborted()) return;

    workspace = options.cwd
      ? { cwd: options.cwd, remove: async () => undefined }
      : await createEmptyCodexCwd();
    if (aborted()) return;
    session = await options.harness.open({
      cwd: workspace.cwd,
      model: options.model,
      approvalPolicy: "never",
      sandboxPolicy: "readOnly",
      autoApproval: "decline",
    });
    // An abort during open() must not start a turn after the HTTP slot was released.
    if (aborted()) return;
    // interrupt() rejects until startTurn has a turn id. Closing is what
    // actually stops a run cancelled during thread/start.
    const pending = session.startTurn(renderCodexPrompt(options.prompt, input, maxSteps)).then(
      () => {
        turnReady = true;
        if (aborted()) stop();
        return { ok: true as const };
      },
      (error: unknown) => {
        void session?.close();
        return { ok: false as const, error };
      },
    );
    const names = (input.tools ?? []).map((tool) => tool.name);
    try {
      yield* interpretCodexEvents(session.events, names);
    } catch (error) {
      const started = await pending;
      if (!started.ok) throw started.error;
      throw error;
    }
    const started = await pending;
    if (!started.ok) throw started.error;
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    try {
      await session?.close();
    } finally {
      await workspace?.remove();
      if (claimed) options.permit?.finish();
    }
  }
}

async function createEmptyCodexCwd(): Promise<{ cwd: string; remove: () => Promise<void> }> {
  const cwd = await mkdtemp(join(tmpdir(), "nextflow-codex-"));
  return {
    cwd,
    remove: () => rm(cwd, { recursive: true, force: true }),
  };
}

function resolveMaxSteps(value: number | undefined): number {
  if (value === undefined || !Number.isInteger(value) || value < 1) return ASSISTANT_MAX_STEPS;
  return value;
}

function textEvent(messageId: string, delta: string): CodexAguiEvent {
  return { type: "TEXT_MESSAGE_CHUNK", role: "assistant", messageId, delta };
}

function shouldStream(raw: string): boolean {
  const trimmed = raw.trimStart().replace(/^\uFEFF/, "");
  if (!trimmed) return false;
  if (trimmed.startsWith("{") || trimmed.startsWith("```")) return false;
  // One or two backticks can still become an opening ``` fence.
  return trimmed !== "`" && trimmed !== "``";
}

function renderMessage(message: PromptMessage): string {
  if (message.role === "activity" || message.role === "reasoning") return "";
  if (message.role === "tool") return `工具结果 ${message.toolCallId ?? ""}:\n${textContent(message.content)}`;
  const calls = message.toolCalls?.map((call) => `调用 ${call.function.name} ${call.function.arguments}`).join("\n") ?? "";
  const body = [textContent(message.content), calls].filter(Boolean).join("\n");
  const label = message.role === "assistant" ? "助手" : message.role === "user" ? "用户" : message.role;
  return `${label}:\n${body}`;
}

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (typeof part === "string") return part;
    if (isRecord(part) && typeof part.text === "string") return part.text;
    return "";
  }).filter(Boolean).join("");
}

function unwrapFence(text: string): string {
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1]?.trim() ?? text;
}

interface ToolSpan {
  start: number;
  end: number;
  name: string;
  arguments: unknown;
}

function toolSpans(text: string): ToolSpan[] {
  const spans: ToolSpan[] = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "{") continue;
    const end = endOfJsonObject(text, index);
    if (end === undefined) continue;
    let value: unknown;
    try {
      value = JSON.parse(text.slice(index, end));
    } catch {
      continue;
    }
    const next = end - 1;
    if (!isRecord(value) || typeof value.tool !== "string") {
      index = next;
      continue;
    }
    spans.push({ start: index, end, name: value.tool, arguments: value.arguments });
    index = next;
  }
  return spans;
}

function endOfJsonObject(text: string, start: number): number | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return undefined;
}

function readArguments(value: unknown): Record<string, unknown> | undefined {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return value === undefined ? {} : undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function hasState(state: unknown): boolean {
  if (!isRecord(state)) return state !== undefined && state !== null;
  return Object.keys(state).length > 0;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "{}";
  }
}

function clipName(name: string): string {
  const flat = Array.from(name).map((char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127 ? " " : char;
  }).join("").replace(/\s+/g, " ").trim();
  if (!flat) return "";
  return flat.length > 80 ? `${flat.slice(0, 80)}…` : flat;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
