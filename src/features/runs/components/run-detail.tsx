"use client";

import * as React from "react";
import Link from "next/link";
import { PanelLoading, PanelNotice } from "@/components/ui/panel-notice";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CodeViewer } from "@/features/project/components/code-viewer";
import { ProjectPreview } from "@/features/project/components/project-preview";
import { ApiError } from "@/lib/api";
import { useModuleCatalog } from "@/features/workflow/queries";
import { RunAssistant } from "@/features/assistant/run-assistant";
import { isActive, useRefreshWhenDone, useRun, useRunTasks } from "../queries";
import type { RunDetail } from "../types";
import { RunGraph } from "./run-graph";
import { RunConsole, RunResults } from "./run-results";
import { RunHeader } from "./run-header";
import { TaskTable } from "./task-table";

export function RunDetailView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params);
  const run = useRun(id);

  if (run.isPending) {
    return <PanelLoading />;
  }
  if (run.error) {
    const missing = run.error instanceof ApiError && run.error.status === 404;
    return (
      <PanelNotice
        message={
          missing
            ? "这个运行不存在或已被删除"
            : `加载失败：${run.error.message}`
        }
        tone={missing ? "muted" : "danger"}
      >
        <Button asChild variant="outline" size="sm">
          <Link href="/runs">返回运行记录</Link>
        </Button>
      </PanelNotice>
    );
  }

  return <RunBody run={run.data} />;
}

function RunBody({ run: data }: { run: RunDetail }) {
  const active = isActive(data.status);
  const catalog = useModuleCatalog();
  const tasks = useRunTasks(data.id, active);
  useRefreshWhenDone(data.id, active);
  const [tab, setTab] = React.useState("graph");
  const [nodeFilter, setNodeFilter] = React.useState<string | null>(null);
  const index = catalog.data?.index;

  return (
    <section className="glass flex size-full flex-col gap-5 overflow-hidden rounded-xl p-5">
      <RunHeader run={data} />
      <RunAssistant run={data} tasks={tasks.data} />
      <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1">
        <TabsList>
          <TabsTrigger value="graph">流程图</TabsTrigger>
          <TabsTrigger value="tasks">
            任务{tasks.data && ` · ${tasks.data.length}`}
          </TabsTrigger>
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
          <p className="pt-2 text-xs text-muted-foreground">
            点击节点查看它的任务和日志。
          </p>
        </TabsContent>
        <TabsContent value="tasks" className="flex min-h-0 flex-col">
          <TaskTable
            runId={data.id}
            tasks={tasks.data ?? []}
            active={active}
            nodeFilter={nodeFilter}
            nodeLabel={
              data.workflow.nodes.find((n) => n.id === nodeFilter)?.data.alias
            }
            onClearFilter={() => setNodeFilter(null)}
          />
        </TabsContent>
        <TabsContent value="log" className="flex min-h-0 flex-col">
          <RunConsole runId={data.id} active={active} />
        </TabsContent>
        <TabsContent value="results" className="flex min-h-0 flex-col">
          <RunResults
            runId={data.id}
            active={active}
            outdir={String(data.params.outdir ?? "results")}
          />
        </TabsContent>
        <TabsContent
          value="launch"
          className="grid min-h-0 content-start gap-4 overflow-auto lg:grid-cols-2"
        >
          <div className="grid content-start gap-1.5 lg:col-span-2">
            <span className="text-xs font-semibold text-muted-foreground">
              命令
            </span>
            <CodeViewer
              code={data.command}
              language="text"
              lineNumbers={false}
            />
          </div>
          <div className="grid content-start gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground">
              run.config
            </span>
            <CodeViewer code={data.runConfig} language="groovy" />
          </div>
          <div className="grid content-start gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground">
              params.json
            </span>
            <CodeViewer
              code={JSON.stringify(data.params, null, 2)}
              language="json"
            />
          </div>
        </TabsContent>
        <TabsContent value="project" className="flex min-h-0 flex-col">
          <ProjectPreview
            files={data.project.files}
            components={data.project.components}
            className="min-h-0 flex-1"
          />
        </TabsContent>
      </Tabs>
    </section>
  );
}
