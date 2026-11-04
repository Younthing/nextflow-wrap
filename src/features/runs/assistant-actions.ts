import {
  infoConfirmView,
  type AcceptedResult,
  type ConfirmView,
  type ConfirmedResult,
  type PreparedInvocation,
} from "@/features/assistant/confirm";
import type { RunDetail, RunStatus, TaskRecord } from "./types";

/*
 * What the run-diagnostics assistant reads and the checks behind its stop and
 * resume tools. {@link prepareRunControl} builds each tool's confirm and call;
 * the surface registers the tools; the run API stays in queries.
 */

/** A launched, stopped, or resumed run, as the model hears it. */
export interface AcceptedRun extends AcceptedResult {
  runId: string;
  runName: string;
  status: string;
  phase?: string;
  resumedFrom?: string;
}

export type RunToolResult = ConfirmedResult<AcceptedRun>;

/** What the assistant needs to explain a run, without the generated files. */
export function runSummary(run: RunDetail, tasks: TaskRecord[]) {
  const alias = new Map(run.workflow.nodes.map((n) => [n.id, n.data.alias]));
  const failed = tasks.filter((t) => t.status === "failed");
  return {
    runId: run.id,
    runName: run.runName,
    workflow: run.workflowName,
    status: run.status,
    ...(run.errorMessage && { errorMessage: run.errorMessage }),
    executor: run.executor,
    profile: run.profile,
    command: run.command,
    params: run.params,
    progress: run.progress,
    failedTasks: failed.map((t) => ({
      id: t.id ?? t.hash,
      attempt: t.attempt,
      name: t.name,
      hash: t.hash,
      node: alias.get(t.nodeId),
      exitStatus: t.exitStatus,
      cpus: t.cpus,
      peakRss: t.peakRss,
      workdir: t.workdir,
    })),
    edges: run.workflow.edges.map((e) => `${alias.get(e.source)} -> ${alias.get(e.target)}`),
  };
}

/** A task by id, hash, or name, the way the model names it. */
export function findTask(tasks: readonly TaskRecord[], task: string): TaskRecord | undefined {
  return tasks.find((t) => t.id === task || t.hash === task || t.name === task);
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
): ConfirmView {
  if (problems.length)
    return infoConfirmView(
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
): ConfirmView {
  if (problems.length)
    return infoConfirmView(
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


/** The run APIs `cancel_run` and `resume_run` call, and the run on screen at call time. */
export interface RunControlServices {
  current(): RunDetail | undefined;
  cancel(runId: string): Promise<RunDetail>;
  resume(runId: string): Promise<RunDetail>;
  openRun(runId: string): void;
}

export type RunControl = "cancel" | "resume";

/**
 * prepareInvocation for `cancel_run` / `resume_run` on the run shown now. The
 * accept-time check refuses if the page moved to another run or the run's
 * state no longer allows the action.
 */
export function prepareRunControl(
  services: RunControlServices,
  action: RunControl,
  reason?: string,
): PreparedInvocation<AcceptedRun> {
  const opened = services.current();
  if (!opened) throw new Error("当前页面没有打开运行，没有执行。");
  const blockers = action === "cancel" ? cancelBlockers : resumeBlockers;
  const view = action === "cancel" ? cancelConfirmView : resumeConfirmView;
  const moved = "当前页面已经不是这次运行，没有执行。";
  const latest = () => {
    const run = services.current();
    return run && run.id === opened.id ? run : undefined;
  };
  return {
    view: view(opened.runName, blockers(opened), reason),
    problems: () => {
      const run = latest();
      return run ? blockers(run) : [moved];
    },
    invoke: async () => {
      const run = latest();
      if (!run) throw new Error(moved);
      if (action === "cancel") {
        const next = await services.cancel(run.id);
        const message = next.status === "cancelled" ? `已停止 ${next.runName}` : `正在停止 ${next.runName}`;
        return { accepted: true, runId: next.id, runName: next.runName, status: next.status, ...(next.phase ? { phase: next.phase } : {}), message };
      }
      const next = await services.resume(run.id);
      services.openRun(next.id);
      return {
        accepted: true,
        runId: next.id,
        runName: next.runName,
        status: next.status,
        resumedFrom: run.id,
        message: `已恢复，新运行是 ${next.runName}`,
      };
    },
  };
}
