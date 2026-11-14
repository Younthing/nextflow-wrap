"use client";

import * as React from "react";
import { useAgentContext, useConfigureSuggestions, useFrontendTool, type JsonSerializable } from "@copilotkit/react-core/v2";
import { z } from "zod";

import { findTask, runSummary } from "@/features/runs/assistant-actions";
import { fetchRunLog, fetchTaskLog, isActive } from "@/features/runs/queries";
import type { RunDetail, TaskRecord } from "@/features/runs/types";
import { useAssistantStatus } from "../assistant-provider";
import { useAssistantModule } from "../modules/activation";
import { moduleTool } from "../modules/contract";
import { RUN_LOG_TAIL, runDiagnosticsModule } from "../modules/run-diagnostics";
import { RunControlTools } from "./run-control";
import { useComposerReferences } from "../composer";
import { useToolNavigation } from "../tool-record";

type OpenRunLocation = (destination: "log" | "tasks", nodeId?: string, taskId?: string) => void;

function RunTools({ run, tasks, onOpenLocation }: { run: RunDetail; tasks: TaskRecord[]; onOpenLocation?: OpenRunLocation }) {
  const summary = React.useMemo(() => runSummary(run, tasks), [run, tasks]);
  useAgentContext({ description: "用户正在查看的这次 Nextflow 运行", value: summary as unknown as JsonSerializable });
  useComposerReferences(React.useMemo(() => ({
    title: "当前运行",
    items: [{ label: run.runName, text: `运行 ${run.runName}` }],
  }), [run.runName]));
  useToolNavigation(React.useCallback((result) => {
    const destination = result.destination;
    if (!onOpenLocation || result.runId !== run.id || (destination !== "log" && destination !== "tasks")) return;
    const nodeId = typeof result.nodeId === "string" ? result.nodeId : undefined;
    const taskId = typeof result.taskId === "string" ? result.taskId : undefined;
    return () => onOpenLocation(destination, nodeId, taskId);
  }, [run.id, onOpenLocation]));

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
        const match = findTask(tasks, task);
        if (!match) return { error: `找不到任务 ${task}` };
        const { text } = await fetchTaskLog(run.id, match.id ?? match.hash);
        return { runId: run.id, destination: "tasks", nodeId: match.nodeId, taskId: match.id ?? match.hash, task: match.name, status: match.status, exitStatus: match.exitStatus, log: text };
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
        const { lines } = await fetchRunLog(run.id);
        return { runId: run.id, destination: "log", lines: lines.slice(-RUN_LOG_TAIL) };
      },
    },
    [run.id],
  );

  return null;
}

/** Run-diagnostics module: read the run on screen, then stop or resume after confirmation. */
export function RunAssistant({ run, tasks, onOpenLocation }: { run: RunDetail; tasks: TaskRecord[] | undefined; onOpenLocation?: OpenRunLocation }) {
  useAssistantModule(runDiagnosticsModule.id);
  if (!useAssistantStatus().enabled) return null;
  return (
    <>
      <RunTools run={run} tasks={tasks ?? []} onOpenLocation={onOpenLocation} />
      <RunControlTools run={run} />
    </>
  );
}
