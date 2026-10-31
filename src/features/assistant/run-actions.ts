import { z } from "zod";

import {
  getEditorSaveSession,
  type EditorSaveRead,
} from "@/features/editor/editor-save";
import {
  useEditorStore,
  selectIsDirty,
  type EditorStore,
} from "@/features/editor/store";
import { api } from "@/lib/api";
import { GenerateError, generateProject } from "@/features/project/generate";
import {
  EXECUTORS,
  executorDef,
  launchCommand,
  launchProblems,
  profileList,
  realLaunchConfig,
  renderRunConfig,
  type LaunchConfig,
} from "@/features/project/launch";
import type { ModuleIndex } from "@/features/workflow/catalog";
import { validateWorkflow } from "@/features/workflow/validate";
import type { WorkflowDoc } from "@/features/workflow/types";
import type { LaunchRequest, RunStatus } from "@/features/runs/types";

/**
 * Assistant tools that start, stop, or resume a run. The handler waits on a
 * confirm dialog and only then calls the run API. These stay ordinary
 * frontend tools: CopilotKit replays unanswered human-in-the-loop calls after
 * a refresh, which could submit a second run.
 */

export const START_RUN_DESCRIPTION =
  "启动编辑器里当前已保存的流程。调用后会弹出确认对话框，只有用户接受才会提交运行；拒绝、关闭或中断都不会启动。使用运行对话框里保存的执行器、profile 和工作目录。你必须等这个工具返回后再说运行已启动。";

export const CANCEL_RUN_DESCRIPTION =
  "停止用户正在查看的这次运行。调用后会弹出确认对话框，只有用户接受才会调用取消接口。已经结束的运行不能停止。你必须等这个工具返回后再说运行已停止。";

export const RESUME_RUN_DESCRIPTION =
  "从用户正在查看的、已结束且有 Nextflow session 的运行恢复（-resume）。调用后会弹出确认对话框，只有用户接受才会提交恢复。你必须等这个工具返回后再说已经恢复。";

export const runToolParameters = z.object({
  reason: z
    .string()
    .optional()
    .describe("展示在确认对话框里的一句话。不能代替用户确认。"),
});

export interface AcceptedRun {
  accepted: true;
  runId: string;
  runName: string;
  status: string;
  message: string;
  phase?: string;
  resumedFrom?: string;
}

export type RunToolResult =
  | AcceptedRun
  | { accepted: true; error: string; message: string }
  | { accepted: false; declined: true; message: string }
  | { accepted: false; blocked: true; problems: string[]; message: string };

export function declinedResult(message: string): RunToolResult {
  return { accepted: false, declined: true, message };
}

export function blockedResult(problems: readonly string[]): RunToolResult {
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
export async function settleConfirmedAction(
  decision: "accept" | "decline",
  problems: readonly string[],
  execute: () => Promise<AcceptedRun>,
  declinedMessage: string,
): Promise<RunToolResult> {
  if (problems.length > 0) return blockedResult(problems);
  if (decision !== "accept") return declinedResult(declinedMessage);
  try {
    return await execute();
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { accepted: true, error, message: `执行失败：${error}` };
  }
}

export interface ConfirmThenRunOptions {
  isReplay: boolean;
  aborted: () => boolean;
  /** ComfyUI `confirm()`: `true` is the confirm button; `null` is cancel, close, or Escape. */
  ask: (view: RunConfirmView) => Promise<true | null>;
  close: () => void;
  view: RunConfirmView;
  /** Re-checked at accept time, so a run that finished while the dialog was open is not cancelled. */
  problems: () => readonly string[];
  execute: () => Promise<AcceptedRun>;
  interruptedMessage: string;
}

/** Shows the confirm view, then settles. Replay, cancel, close, and abort never call `execute`. */
export async function confirmThenRun(
  options: ConfirmThenRunOptions,
): Promise<RunToolResult> {
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

export interface RunConfirmView {
  title: string;
  message: string;
  type: ConfirmationDialogType;
  /** Shown as a bullet list under the message, like ComfyUI `itemList`. */
  itemList: string[];
  hint?: string;
  problems: string[];
  declinedMessage: string;
}

export interface StartRunInput {
  docId: string;
  doc: WorkflowDoc;
  index: ModuleIndex;
  modulesSha: string;
  config: LaunchConfig;
  /** Real runner: lock the launch the way the run dialog does. */
  real: boolean;
  runnerReady: boolean;
  diagnostics?: string;
  catalogError?: string;
}

export interface StartRunPlan {
  launch: LaunchConfig;
  command: string;
  runConfig: string;
  profile: string;
  problems: string[];
  modulesSha: string;
  workflow: WorkflowDoc;
  request: LaunchRequest | null;
}

/** Real mode uses the same local launch as the run dialog. Shell stays; other engines become Docker. */
export function effectiveLaunchConfig(
  config: LaunchConfig,
  real: boolean,
): LaunchConfig {
  if (!real) return config;
  return realLaunchConfig(config);
}

/** Builds the same launch request the run dialog submits, or the reasons it would refuse. */
export function prepareStartRun(input: StartRunInput): StartRunPlan {
  const launch = effectiveLaunchConfig(input.config, input.real);
  const knownExecutor = EXECUTORS.some(
    (executor) => executor.id === launch.executor,
  );
  const problems: string[] = [];
  if (!input.docId) problems.push("请先保存流程（Ctrl+S）");
  if (!input.index.size) problems.push(input.catalogError ?? "模块库还在加载");
  if (!knownExecutor)
    problems.push(`不支持的执行器 ${String(launch.executor)}`);

  let project: ReturnType<typeof generateProject> | null = null;
  if (input.index.size && knownExecutor) {
    try {
      project = generateProject(input.doc, input.index, {
        modulesSha: input.modulesSha,
        registry: launch.registry,
      });
    } catch (err) {
      if (err instanceof GenerateError)
        problems.push(`无法生成项目：${err.message}`);
      else throw err;
    }
  }

  if (input.index.size) {
    for (const issue of validateWorkflow(
      input.doc.nodes,
      input.doc.edges,
      input.doc.params,
      input.index,
    )) {
      if (issue.level === "error") problems.push(issue.message);
    }
  }
  if (knownExecutor) problems.push(...launchProblems(launch));
  if (input.real && !input.runnerReady)
    problems.push(input.diagnostics || "Runner 未就绪");

  const command = knownExecutor ? launchCommand(launch) : "";
  const runConfig = knownExecutor ? renderRunConfig(launch) : "";
  const profile = knownExecutor ? profileList(launch) : "";
  const request: LaunchRequest | null =
    problems.length === 0 && project
      ? {
          workflow: input.doc,
          project: {
            name: project.meta.name,
            files: project.files.map(({ path, content }) => ({
              path,
              content,
            })),
            components: project.components,
          },
          params: input.doc.params,
          launch,
          modulesSha: input.modulesSha,
          runConfig,
          command,
        }
      : null;

  return {
    launch,
    command,
    runConfig,
    profile,
    problems,
    modulesSha: input.modulesSha,
    workflow: input.doc,
    request,
  };
}

/** Ignores `updatedAt`. It is the server revision, not canvas content. */
export function startPlanStamp(plan: StartRunPlan): string {
  const doc = plan.workflow;
  return JSON.stringify({
    modulesSha: plan.modulesSha,
    command: plan.command,
    runConfig: plan.runConfig,
    problems: plan.problems,
    id: doc.id,
    name: doc.name,
    params: doc.params,
    project: doc.project,
    nodes: doc.nodes,
    edges: doc.edges,
  });
}

export function startConfirmView(
  plan: StartRunPlan,
  reason?: string,
): RunConfirmView {
  const name = plan.workflow.name || "未命名流程";
  if (plan.problems.length) {
    return infoConfirm(
      "无法启动",
      `不能启动「${name}」。`,
      plan.problems,
      "用户关闭了确认，没有启动运行。",
      reason,
    );
  }
  const executorName = EXECUTORS.some(
    (executor) => executor.id === plan.launch.executor,
  )
    ? executorDef(plan.launch.executor).name
    : String(plan.launch.executor);
  return {
    title: "启动运行",
    message: `将启动「${name}」。点确认之后才会提交。`,
    type: "default",
    itemList: [
      name,
      `${executorName} · ${plan.profile || "—"}`,
      `工作目录 ${plan.launch.workDir}`,
      ...(plan.command ? [plan.command] : []),
    ],
    hint: reason,
    problems: [],
    declinedMessage: "用户取消了确认，没有启动运行。",
  };
}

export function cancelBlockers(run: {
  status: RunStatus;
  phase?: string;
}): string[] {
  if (run.phase === "cancelling") return ["这次运行正在停止。"];
  if (run.status !== "submitted" && run.status !== "running")
    return ["这次运行已经结束，不能再停止。"];
  return [];
}

export function resumeBlockers(run: {
  status: RunStatus;
  nextflowSessionId?: string;
}): string[] {
  if (run.status === "submitted" || run.status === "running")
    return ["运行还在进行，不能恢复。可以先停止，或等它结束。"];
  if (!run.nextflowSessionId)
    return ["这次运行没有 Nextflow session，不能从这里恢复。"];
  return [];
}

export function cancelConfirmView(
  runName: string,
  problems: string[],
  reason?: string,
): RunConfirmView {
  if (problems.length)
    return infoConfirm(
      "无法停止",
      `不能停止「${runName}」。`,
      problems,
      "用户关闭了确认，没有停止运行。",
      reason,
    );
  return {
    title: "停止运行",
    message: `停止「${runName}」会取消正在计算的任务。点确认之后才会停止。`,
    // ComfyUI uses `delete` for a destructive confirm: Cancel stays focused, the other button is red.
    type: "delete",
    itemList: [runName],
    hint: reason,
    problems: [],
    declinedMessage: "用户取消了确认，没有停止运行。",
  };
}

export function resumeConfirmView(
  runName: string,
  problems: string[],
  reason?: string,
): RunConfirmView {
  if (problems.length)
    return infoConfirm(
      "无法恢复",
      `不能从「${runName}」恢复。`,
      problems,
      "用户关闭了确认，没有恢复运行。",
      reason,
    );
  return {
    title: "从这次运行恢复",
    message: `用 Nextflow -resume 从「${runName}」接着跑。已完成且可缓存的任务会复用。点确认之后才会提交。`,
    type: "default",
    itemList: [runName],
    hint: reason,
    problems: [],
    declinedMessage: "用户取消了确认，没有恢复运行。",
  };
}

function infoConfirm(
  title: string,
  message: string,
  problems: string[],
  declinedMessage: string,
  reason?: string,
): RunConfirmView {
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

/** Saves a dirty, already-saved workflow through the editor queue. A new unsaved canvas is refused. */
export async function ensureWorkflowSaved(
  save: (doc: WorkflowDoc) => Promise<WorkflowDoc>,
  owner?: EditorStore,
): Promise<{ doc: WorkflowDoc } | { error: string }> {
  const store = owner ?? useEditorStore;
  const session = getEditorSaveSession(owner);
  if (!store.getState().docId) return { error: "请先保存流程（Ctrl+S）" };
  let failure: string | undefined;
  try {
    await session.enqueueEditorSave(true, async () => {
      const state = store.getState();
      if (!state.docId) {
        failure = "请先保存流程（Ctrl+S）";
        return;
      }
      if (!selectIsDirty(state)) return;
      const snapshot: EditorSaveRead = {
        docId: state.docId,
        revision: state.revision,
        generation: state.generation,
        dirty: true,
        doc: state.toDoc(),
        issues: [],
      };
      await session.runEditorSave({
        announce: false,
        snapshot,
        save,
        markSaved: (revision, updatedAt) => {
          const next = store.getState();
          if (
            next.generation === state.generation &&
            next.docId === state.docId
          )
            next.markSaved(revision, updatedAt);
        },
        stillOpen: (generation, docId) => {
          const next = store.getState();
          return next.generation === generation && next.docId === docId;
        },
        fetchCurrent: (id) => api<WorkflowDoc>(`/workflows/${id}`),
        load: (doc) => store.getState().load(doc),
        toastSaved: () => {},
        toastError: (message) => {
          failure = message;
        },
      });
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `保存失败：${message}` };
  }
  if (failure)
    return {
      error: failure.startsWith("保存失败") ? failure : `保存失败：${failure}`,
    };
  return { doc: store.getState().toDoc() };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
