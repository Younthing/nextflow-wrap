import { z } from "zod";

import { isRecord } from "@/lib/record";

/**
 * Confirm-before-invoke for risky assistant tools (VS Code's
 * `prepareInvocation` → `invoke`). A surface builds a {@link ConfirmView},
 * the host dialog asks, and only an explicit accept calls `execute`.
 * These stay ordinary frontend tools: CopilotKit replays unanswered
 * human-in-the-loop calls after a refresh, which could repeat the action.
 */

export const confirmReasonParameters = z.object({
  reason: z
    .string()
    .optional()
    .describe("展示在确认对话框里的一句话。不能代替用户确认。"),
});

/** What `execute` returns once the user accepted. */
export interface AcceptedResult {
  accepted: true;
  message: string;
}

/** Declined, closed, interrupted, or blocked: `execute` never ran. */
export type RefusedResult =
  | { accepted: false; declined: true; message: string }
  | { accepted: false; blocked: true; problems: string[]; message: string };

export type ConfirmedResult<T extends AcceptedResult> =
  | T
  | { accepted: true; error: string; message: string }
  | RefusedResult;

export function declinedResult(message: string): RefusedResult {
  return { accepted: false, declined: true, message };
}

export function blockedResult(problems: readonly string[]): RefusedResult {
  return {
    accepted: false,
    blocked: true,
    problems: [...problems],
    message: problems.length
      ? `没有执行：${problems.join("；")}`
      : "没有执行。",
  };
}

/** One sentence from a tool result, for the chat card after the dialog closes. */
export function messageFromToolResult(result: unknown): string {
  const value = typeof result === "string" ? parseJson(result) : result;
  if (isRecord(value) && typeof value.message === "string")
    return value.message;
  return "已完成。";
}

export function clipReason(reason: unknown): string | undefined {
  if (typeof reason !== "string") return undefined;
  const text = reason.trim();
  if (!text) return undefined;
  return text.length > 280 ? `${text.slice(0, 279)}…` : text;
}

/**
 * Runs `execute` only after an explicit accept and only when nothing blocks it.
 * Decline, a closed dialog, and a failed precondition never call `execute`.
 */
export async function settleConfirmedAction<T extends AcceptedResult>(
  decision: "accept" | "decline",
  problems: readonly string[],
  execute: () => Promise<T>,
  declinedMessage: string,
): Promise<ConfirmedResult<T>> {
  if (problems.length > 0) return blockedResult(problems);
  if (decision !== "accept") return declinedResult(declinedMessage);
  try {
    return await execute();
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { accepted: true, error, message: `执行失败：${error}` };
  }
}

export interface ConfirmThenRunOptions<T extends AcceptedResult> {
  isReplay: boolean;
  aborted: () => boolean;
  /** ComfyUI `confirm()`: `true` is the confirm button; `null` is cancel, close, or Escape. */
  ask: (view: ConfirmView) => Promise<true | null>;
  close: () => void;
  view: ConfirmView;
  /** Re-checked at accept time, so a run that finished while the dialog was open is not cancelled. */
  problems: () => readonly string[];
  execute: () => Promise<T>;
  interruptedMessage: string;
}

/** Shows the confirm view, then settles. Replay, cancel, close, and abort never call `execute`. */
export async function confirmThenRun<T extends AcceptedResult>(
  options: ConfirmThenRunOptions<T>,
): Promise<ConfirmedResult<T>> {
  if (options.isReplay) {
    return declinedResult("页面恢复了未完成的确认，没有再次执行。请再说一次。");
  }
  // Preparation (save, health, catalog) can be aborted before ask opens the modal.
  // Close without asking so a stop does not leave that dialog on screen.
  if (options.aborted()) {
    options.close();
    return declinedResult(options.interruptedMessage);
  }
  const decision = await options.ask(options.view);
  if (options.aborted()) {
    options.close();
    return declinedResult(options.interruptedMessage);
  }
  if (decision !== true) {
    options.close();
    return settleConfirmedAction(
      "decline",
      options.view.problems,
      options.execute,
      options.view.declinedMessage,
    );
  }
  try {
    return await settleConfirmedAction(
      "accept",
      options.problems(),
      options.execute,
      options.view.declinedMessage,
    );
  } finally {
    options.close();
  }
}

/** Serializes confirmations so a second tool call cannot dismiss the first as a fake decline. */
export function createConfirmQueue() {
  let tail: Promise<void> = Promise.resolve();
  return function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = tail.then(task, task);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

/**
 * ComfyUI `dialogService.confirm` types. `default` is Cancel + Confirm.
 * `delete` is the destructive row (Cancel focused, red confirm). `info` is
 * only an OK button, used when the action cannot run.
 */
export type ConfirmationDialogType = "default" | "delete" | "info";

export interface ConfirmView {
  title: string;
  message: string;
  type: ConfirmationDialogType;
  /** Shown as a bullet list under the message, like ComfyUI `itemList`. */
  itemList: string[];
  hint?: string;
  problems: string[];
  declinedMessage: string;
}

/** An OK-only view for an action that cannot run. */
export function infoConfirmView(
  title: string,
  message: string,
  problems: string[],
  declinedMessage: string,
  reason?: string,
): ConfirmView {
  return {
    title,
    message,
    type: "info",
    itemList: problems,
    hint: reason,
    problems,
    declinedMessage,
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
