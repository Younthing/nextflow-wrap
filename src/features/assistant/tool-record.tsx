"use client";

import * as React from "react";
import { useAgent, useDefaultRenderTool, UseAgentUpdate } from "@copilotkit/react-core/v2";
import { ArrowUpRight } from "lucide-react";
import { isRecord } from "@/lib/record";
import { toast } from "@/lib/toast";

const labels: Record<string, string> = {
  get_notebook_summary: "读取笔记本",
  edit_notebook_cell: "修改单元格",
  run_notebook_cell: "运行单元格",
  read_cell_output: "读取单元格输出",
  list_notebook_variables: "列出内核变量",
  get_notebook_variable: "读取内核变量",
  search_modules: "搜索模块",
  add_module: "添加模块",
  connect_nodes: "连接节点",
  disconnect_nodes: "断开连线",
  remove_node: "移除节点",
  configure_node: "配置节点",
  set_pipeline_param: "设置流程参数",
  start_run: "启动流程",
  get_task_log: "读取任务日志",
  get_run_log: "读取运行日志",
  cancel_run: "停止运行",
  resume_run: "恢复运行",
};
const RUN_UPDATES = [UseAgentUpdate.OnRunStatusChanged];

export function useAssistantRunning() {
  return useAgent({ updates: RUN_UPDATES }).agent.isRunning;
}

const ToolNavigation = React.createContext<ToolTargetResolver | null>(null);
type ToolTargetResolver = (result: Record<string, unknown>) => (() => void) | undefined;
const NavigationRegistration = React.createContext<((resolver: ToolTargetResolver) => () => void) | null>(null);

export function ToolNavigationProvider({ children }: { children: React.ReactNode }) {
  const resolvers = React.useRef(new Set<ToolTargetResolver>());
  const register = React.useCallback((resolver: ToolTargetResolver) => {
    resolvers.current.add(resolver);
    return () => { resolvers.current.delete(resolver); };
  }, []);
  const resolve = React.useCallback<ToolTargetResolver>((result) => {
    for (const resolver of resolvers.current) {
      const target = resolver(result);
      if (target) return target;
    }
  }, []);
  return <NavigationRegistration value={register}><ToolNavigation value={resolve}>{children}</ToolNavigation></NavigationRegistration>;
}

/** Targets are evaluated at click time, so archived results cannot target a different document. */
export function useToolNavigation(resolver: ToolTargetResolver) {
  const register = React.useContext(NavigationRegistration);
  React.useLayoutEffect(() => register?.(resolver), [register, resolver]);
}

function parseResult(result?: string): unknown {
  if (!result) return undefined;
  try { return JSON.parse(result) as unknown; } catch { return result; }
}

function ToolRecord({ name, status, result }: { name: string; status: string; result?: string }) {
  const running = useAssistantRunning();
  const value = parseResult(result);
  const record = isRecord(value) ? value : undefined;
  const failed = Boolean(record?.error || record?.blocked || record?.status === "error" || record?.status === "failed");
  const summary = status !== "complete" ? (running ? "执行中" : "已停止")
    : typeof record?.message === "string" ? record.message
      : failed ? "执行失败" : "已完成";
  const details = typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value, null, 2);

  return (
    <div className="grid min-w-0 gap-1 text-xs">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium text-foreground">{Object.hasOwn(labels, name) ? labels[name] : name}</span>
        <span className={failed ? "text-destructive" : "text-muted-foreground"}>{summary}</span>
      </div>
      {details && (
        <details>
          <summary className="cursor-pointer text-muted-foreground">查看详情</summary>
          <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted p-2 whitespace-pre-wrap [overflow-wrap:anywhere]">{details.slice(0, 8_000)}{details.length > 8_000 ? "\n…（已截断）" : ""}</pre>
        </details>
      )}
      {record && <ToolResultLink result={record} />}
    </div>
  );
}

export function ToolResultLink({ result }: { result: Record<string, unknown> }) {
  const navigate = React.useContext(ToolNavigation);
  if (!(result.notebookId && (result.cellId || result.edited || result.inserted))
    && !(result.workflowId && result.nodeId)
    && !(result.runId && result.destination)) return null;
  return (
    <button type="button" className="inline-flex items-center gap-1 justify-self-start text-primary hover:underline" onClick={() => {
      const target = navigate?.(result);
      if (target) target();
      else toast.error("请先打开这条记录对应的文档或运行");
    }}>
      <ArrowUpRight className="size-3" /> {result.destination === "log" ? "打开运行日志" : result.destination === "tasks" ? "定位任务" : "定位结果"}
    </button>
  );
}

export function AssistantToolRecords() {
  useDefaultRenderTool({ render: ToolRecord, group: true });
  return null;
}
