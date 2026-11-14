import type { useAgent } from "@copilotkit/react-core/v2";
import { isRecord } from "@/lib/record";

export type AssistantMessage = ReturnType<typeof useAgent>["agent"]["messages"][number];

export interface AssistantConversation {
  id: string;
  title: string;
  updatedAt: number;
  customTitle?: boolean;
  messages: AssistantMessage[];
}

const MAX_CONVERSATIONS = 20;
const MAX_BYTES = 1_500_000;

function isStoredMessage(value: unknown): value is AssistantMessage {
  if (!isRecord(value) || typeof value.id !== "string") return false;
  switch (value.role) {
    case "assistant":
      return (value.content === undefined || typeof value.content === "string")
        && (value.toolCalls === undefined || (Array.isArray(value.toolCalls) && value.toolCalls.every((call: unknown) =>
          isRecord(call) && typeof call.id === "string" && isRecord(call.function)
          && typeof call.function.name === "string" && typeof call.function.arguments === "string")));
    case "tool":
      return typeof value.toolCallId === "string" && typeof value.content === "string";
    case "activity":
      return typeof value.activityType === "string" && isRecord(value.content);
    case "user":
    case "reasoning":
      return typeof value.content === "string";
    default:
      return false;
  }
}

export function conversationTitle(messages: AssistantMessage[]): string {
  const first = messages.find((message) => message.role === "user");
  const content = first?.content;
  const text = typeof content === "string"
    ? content
    : content?.flatMap((part) => part.type === "text" ? [part.text] : []).join(" ");
  return text?.replace(/\s+/g, " ").trim().slice(0, 72) || "新对话";
}

/** Restoring a conversation never offers the runtime an unanswered tool call to replay. */
export function restorableMessages(messages: AssistantMessage[]): AssistantMessage[] {
  const completed = new Set(messages.flatMap((message) => message.role === "tool" ? [message.toolCallId] : []));
  return messages.flatMap<AssistantMessage>((message) => {
    if (message.role === "assistant" && message.toolCalls?.length) {
      const toolCalls = message.toolCalls.filter((call) => completed.has(call.id));
      if (!toolCalls.length && !message.content) return [];
      return [{ ...message, toolCalls }];
    }
    return isStoredMessage(message) ? [message] : [];
  });
}

export function historyKey(scope: string) {
  return `nf-studio.assistant.conversations.v1:${encodeURIComponent(scope)}`;
}

export function readConversations(scope: string): AssistantConversation[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(historyKey(scope)) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is AssistantConversation => (
      typeof item?.id === "string" && typeof item.title === "string"
      && typeof item.updatedAt === "number" && Array.isArray(item.messages)
      && item.messages.every(isStoredMessage)
    ));
  } catch {
    return [];
  }
}

export function writeConversations(scope: string, conversations: AssistantConversation[]): AssistantConversation[] | null {
  const recent = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CONVERSATIONS);
  const kept: AssistantConversation[] = [];
  let size = 2;
  for (const conversation of recent) {
    const bytes = JSON.stringify(conversation).length;
    if (size + bytes + 1 > MAX_BYTES) continue;
    size += bytes + 1;
    kept.push(conversation);
  }
  if (conversations.length > 0 && !kept.some((item) => item.id === conversations[0].id)) return null;
  try {
    localStorage.setItem(historyKey(scope), JSON.stringify(kept));
    return kept;
  } catch {
    return null;
  }
}
