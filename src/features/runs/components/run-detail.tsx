"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, PencilRuler, Square, Trash2, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { rememberCurrentId } from "@/features/editor/components/workflow-editor";
import { CodeViewer } from "@/features/project/components/code-viewer";
import { ProjectPreview } from "@/features/project/components/project-preview";
import { ENGINE_LABELS, executorDef } from "@/features/project/launch";
import { ApiError } from "@/lib/api";
import { formatDuration, formatTime, runDuration } from "../format";
import { useModuleCatalog } from "@/features/workflow/queries";
import { isActive, useCancelRun, useDeleteRun, useRun, useRunTasks } from "../queries";
import type { RunDetail } from "../types";
import { RunGraph } from "./run-graph";
import { RunConsole, RunResults } from "./run-results";
import { ProgressBar, StatusBadge } from "./runs-table";
import { TaskTable } from "./task-table";

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  );
}

/** Re-renders every second while the run is active, so the duration ticks. */
function useNow(active: boolean) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function RunHeader({ run }: { run: RunDetail }) {
  const router = useRouter();
  const cancel = useCancelRun();
  const del = useDeleteRun();
  const active = isActive(run.status);
  const now = useNow(active);
  const p = run.progress;

  return (
    <header className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="icon-sm" aria-label="返回运行记录">
          <Link href="/runs">
            <ArrowLeft />
          </Link>
        </Button>
        <h1 className="font-mono text-xl font-semibold">{run.runName}</h1>
        <StatusBadge status={run.status} />
        <span className="text-sm text-muted-foreground">{run.workflowName}</span>
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              rememberCurrentId(run.workflowId);
              router.push("/");
            }}
          >
            <PencilRuler /> 在编辑器中打开
          </Button>
          {active ? (
            <Button variant="destructive" size="sm" disabled={cancel.isPending} onClick={() => cancel.mutate(run.id)}>
              {cancel.isPending ? <Loader2 className="animate-spin" /> : <Square />} 停止
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={del.isPending}
              onClick={() => del.mutate(run.id, { onSuccess: () => router.push("/runs") })}
            >
              <Trash2 /> 删除
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="运行环境">{executorDef(run.executor).name}</Stat>
        <Stat label="软件环境">
          {ENGINE_LABELS[run.launch.engine]}
          {run.launch.extraProfiles.length > 0 && <span className="font-mono text-xs text-muted-foreground"> +{run.launch.extraProfiles.join(",")}</span>}
        </Stat>
        <Stat label="提交时间">{formatTime(run.submittedAt)}</Stat>
        <Stat label="耗时">
          <span className="font-mono">{formatDuration(runDuration(run, now))}</span>
        </Stat>
        <Stat label="工作目录">
          <span className="font-mono text-xs break-all">{run.launch.workDir}</span>
        </Stat>
        <Stat label="任务">
          <span className="font-mono">
            {p.completed + p.cached}/{p.total}
            {p.running > 0 && <span className="text-primary"> · {p.running} 运行中</span>}
            {p.failed > 0 && <span className="text-destructive"> · {p.failed} 失败</span>}
            {p.aborted > 0 && <span className="text-warning"> · {p.aborted} 中止</span>}
          </span>
        </Stat>
      </div>
      <ProgressBar progress={p} className="h-2" />

      {run.errorMessage && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span className="font-mono text-xs leading-5">{run.errorMessage}</span>
        </div>
      )}
    </header>
  );
}

export function RunDetailView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params);
  const run = useRun(id);

  if (run.isPending) {
    return (
      <div className="glass grid size-full place-items-center rounded-xl">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (run.error) {
    const missing = run.error instanceof ApiError && run.error.status === 404;
    return (
      <div className="glass flex size-full flex-col items-center justify-center gap-3 rounded-xl text-sm">
        <span className={missing ? "text-muted-foreground" : "text-destructive"}>
          {missing ? "这个运行不存在或已被删除" : `加载失败：${run.error.message}`}
        </span>
        <Button asChild variant="outline" size="sm">
          <Link href="/runs">返回运行记录</Link>
        </Button>
      </div>
    );
  }

  return <RunBody run={run.data} />;
}

function RunBody({ run: data }: { run: RunDetail }) {
  const active = isActive(data.status);
  const catalog = useModuleCatalog();
  const tasks = useRunTasks(data.id, active);
  const [tab, setTab] = React.useState("graph");
  const [nodeFilter, setNodeFilter] = React.useState<string | null>(null);
  const index = catalog.data?.index;

  return (
    <section className="glass flex size-full flex-col gap-5 overflow-hidden rounded-xl p-5">
      <RunHeader run={data} />
      <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1">
        <TabsList>
          <TabsTrigger value="graph">流程图</TabsTrigger>
          <TabsTrigger value="tasks">任务{tasks.data && ` · ${tasks.data.length}`}</TabsTrigger>
          <TabsTrigger value="log">日志</TabsTrigger>
          <TabsTrigger value="results">结果</TabsTrigger>
          <TabsTrigger value="launch">启动配置</TabsTrigger>
          <TabsTrigger value="project">项目文件</TabsTrigger>
        </TabsList>
        <TabsContent value="graph" className="flex min-h-0 flex-col">
          {index && tasks.data ? (
            <RunGraph
              workflow={data.workflow}
              tasks={tasks.data}
              index={index}
              onSelectNode={(id) => {
                setNodeFilter(id);
                setTab("tasks");
              }}
              className="min-h-0 flex-1"
            />
          ) : (
            <div className="grid flex-1 place-items-center">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          )}
          <p className="pt-2 text-xs text-muted-foreground">点击节点查看它的任务和日志。</p>
        </TabsContent>
        <TabsContent value="tasks" className="flex min-h-0 flex-col">
          <TaskTable
            runId={data.id}
            tasks={tasks.data ?? []}
            active={active}
            nodeFilter={nodeFilter}
            nodeLabel={data.workflow.nodes.find((n) => n.id === nodeFilter)?.data.alias}
            onClearFilter={() => setNodeFilter(null)}
          />
        </TabsContent>
        <TabsContent value="log" className="flex min-h-0 flex-col">
          <RunConsole runId={data.id} active={active} />
        </TabsContent>
        <TabsContent value="results" className="flex min-h-0 flex-col">
          <RunResults runId={data.id} active={active} outdir={String(data.params.outdir ?? "results")} />
        </TabsContent>
        <TabsContent value="launch" className="grid min-h-0 content-start gap-4 overflow-auto lg:grid-cols-2">
          <div className="grid content-start gap-1.5 lg:col-span-2">
            <span className="text-xs font-semibold text-muted-foreground">命令</span>
            <CodeViewer code={data.command} language="text" lineNumbers={false} />
          </div>
          <div className="grid content-start gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground">run.config</span>
            <CodeViewer code={data.runConfig} language="groovy" />
          </div>
          <div className="grid content-start gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground">params.json</span>
            <CodeViewer code={JSON.stringify(data.params, null, 2)} language="json" />
          </div>
        </TabsContent>
        <TabsContent value="project" className="flex min-h-0 flex-col">
          <ProjectPreview files={data.project.files} components={data.project.components} className="min-h-0 flex-1" />
        </TabsContent>
      </Tabs>
    </section>
  );
}
