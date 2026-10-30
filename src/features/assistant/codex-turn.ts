import type { CodexEvent, CodexHarness } from "@/features/codex-harness";

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

const TOOL_INSTRUCTIONS = `需要调用工具时，不要写别的文字，只回复一个 JSON 对象（不要用 markdown）：
{"tool":"工具名","arguments":{}}
一次只调用一个工具。工具结果会在下一条对话里出现。不需要工具时用普通中文回答，不要输出 JSON。
画布和运行记录只能通过这些工具修改。不要用 shell 或改文件来代替工具。`;

export function renderCodexPrompt(system: string, input: PromptInput): string {
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
    parts.push(TOOL_INSTRUCTIONS);
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

export interface ParsedToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/** A tool reply is the whole message, optionally wrapped in one json fence. */
export function parseToolReply(raw: string, toolNames: readonly string[]): ParsedToolCall | undefined {
  const text = unwrapFence(raw.trim());
  if (!text.startsWith("{")) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || typeof parsed.tool !== "string" || !toolNames.includes(parsed.tool)) return undefined;
  const args = readArguments(parsed.arguments);
  if (!args) return undefined;
  return { name: parsed.tool, arguments: args };
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
  if (streamed) return;
  const call = parseToolReply(raw, toolNames);
  if (call) {
    const toolCallId = newId();
    const args = JSON.stringify(call.arguments);
    yield { type: "TOOL_CALL_START", toolCallId, toolCallName: call.name, parentMessageId: messageId };
    yield { type: "TOOL_CALL_ARGS", toolCallId, delta: args };
    yield { type: "TOOL_CALL_END", toolCallId };
    return;
  }
  if (raw) yield textEvent(messageId, raw);
}

export interface CodexAssistantRun {
  harness: CodexHarness;
  prompt: string;
  cwd: string;
  model?: string;
  signal?: AbortSignal;
}

/** One CopilotKit run: a short-lived Codex thread, then AG-UI text or one tool call. */
export async function* runCodexAssistant(input: PromptInput, options: CodexAssistantRun): AsyncGenerator<CodexAguiEvent> {
  const session = await options.harness.open({
    cwd: options.cwd,
    model: options.model,
    approvalPolicy: "never",
    sandboxPolicy: "readOnly",
    autoApproval: "decline",
  });
  // interrupt() rejects until startTurn has a turn id. Closing is what
  // actually stops a run cancelled during thread/start.
  let turnReady = false;
  const stop = () => {
    const cancel = turnReady
      ? session.interrupt().catch(() => session.close())
      : session.close();
    void cancel;
  };
  const onAbort = () => {
    stop();
  };
  options.signal?.addEventListener("abort", onAbort);
  try {
    if (options.signal?.aborted) return;
    const pending = session.startTurn(renderCodexPrompt(options.prompt, input)).then(
      () => {
        turnReady = true;
        if (options.signal?.aborted) stop();
        return { ok: true as const };
      },
      (error: unknown) => {
        void session.close();
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
    await session.close();
  }
}

function textEvent(messageId: string, delta: string): CodexAguiEvent {
  return { type: "TEXT_MESSAGE_CHUNK", role: "assistant", messageId, delta };
}

function shouldStream(raw: string): boolean {
  const trimmed = raw.trimStart();
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
