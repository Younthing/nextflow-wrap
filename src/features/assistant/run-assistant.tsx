"use client";

import * as React from "react";
import { useAgentContext, useConfigureSuggestions, useFrontendTool, type JsonSerializable } from "@copilotkit/react-core/v2";
import { z } from "zod";

import { api } from "@/lib/api";
import { isActive } from "@/features/runs/queries";
import type { RunDetail, TaskRecord } from "@/features/runs/types";
import { useAssistantStatus } from "./assistant-provider";
import { useAssistantModule } from "./modules/activation";
import { moduleTool } from "./modules/contract";
import { RUN_LOG_TAIL, runDiagnosticsModule } from "./modules/run-diagnostics";
import { RunControlTools } from "./run-control-tools";

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

function RunTools({ run, tasks }: { run: RunDetail; tasks: TaskRecord[] }) {
  const summary = React.useMemo(() => runSummary(run, tasks), [run, tasks]);
  useAgentContext({ description: "用户正在查看的这次 Nextflow 运行", value: summary as unknown as JsonSerializable });

  const suggestions = [
    run.status === "failed"
      ? { title: "为什么失败", message: "这次运行为什么失败？该怎么修？" }
      : { title: "运行概况", message: "总结一下这次运行的情况" },
  ];
  if (isActive(run.status)) suggestions.push({ title: "停止运行", message: "停止这次运行" });
  else if (run.nextflowSessionId) suggestions.push({ title: "从这里恢复", message: "从这次运行恢复" });
  useConfigureSuggestions({ suggestions }, [run.status, run.nextflowSessionId]);

  useFrontendTool(
    {
      name: moduleTool(runDiagnosticsModule, "get_task_log").name,
      description: moduleTool(runDiagnosticsModule, "get_task_log").description,
      parameters: z.object({ task: z.string().describe("任务哈希（如 3f/a1b2c3）或任务名（如 FASTQC (S1)）") }),
      handler: async ({ task }) => {
        const match = tasks.find((t) => t.id === task || t.hash === task || t.name === task);
        if (!match) return { error: `找不到任务 ${task}` };
        const { text } = await api<{ text: string }>(`/runs/${run.id}/task-log?hash=${encodeURIComponent(match.id ?? match.hash)}`);
        return { task: match.name, status: match.status, exitStatus: match.exitStatus, log: text };
      },
    },
    [run.id, tasks],
  );

  useFrontendTool(
    {
      name: moduleTool(runDiagnosticsModule, "get_run_log").name,
      description: moduleTool(runDiagnosticsModule, "get_run_log").description,
      parameters: z.object({}),
      handler: async () => {
        const { lines } = await api<{ lines: string[] }>(`/runs/${run.id}/log`);
        return { lines: lines.slice(-RUN_LOG_TAIL) };
      },
    },
    [run.id],
  );

  return null;
}

/** Run-diagnostics module: read the run on screen, then stop or resume after confirmation. */
export function RunAssistant({ run, tasks }: { run: RunDetail; tasks: TaskRecord[] | undefined }) {
  useAssistantModule(runDiagnosticsModule.id);
  if (!useAssistantStatus().enabled) return null;
  return (
    <>
      <RunTools run={run} tasks={tasks ?? []} />
      <RunControlTools run={run} />
    </>
  );
}
