import { infoConfirmView, type ConfirmView } from "@/features/assistant/confirm";
import { getEditorSaveSession, type EditorSaveRead } from "./editor-save";
import { selectIsDirty, type EditorStore } from "./store";
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
import type { LaunchRequest } from "@/features/runs/types";
import { launchParams } from "@/features/workflow/inputs";

/*
 * `start_run` planning for the canvas assistant: the same launch the run
 * dialog would submit, or the reasons it would refuse. The surface asks for
 * confirmation and only then calls the launch API.
 */

export interface StartRunInput {
  docId: string;
  doc: WorkflowDoc;
  index: ModuleIndex;
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
  workflow: WorkflowDoc;
  request: LaunchRequest | null;
}

/** Real mode uses the same launch as the run dialog: the chosen executor and -profile are kept. */
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
          },
          params: launchParams(input.doc),
          launch,
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
    workflow: input.doc,
    request,
  };
}

/** Ignores `updatedAt`. It is the server revision, not canvas content. */
export function startPlanStamp(plan: StartRunPlan): string {
  const doc = plan.workflow;
  return JSON.stringify({
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
): ConfirmView {
  const name = plan.workflow.name || "未命名流程";
  if (plan.problems.length) {
    return infoConfirmView(
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

/** Saves a dirty, already-saved workflow through the editor queue. A new unsaved canvas is refused. */
export async function ensureWorkflowSaved(
  save: (doc: WorkflowDoc) => Promise<WorkflowDoc>,
  store: EditorStore,
): Promise<{ doc: WorkflowDoc } | { error: string }> {
  const session = getEditorSaveSession(store);
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

