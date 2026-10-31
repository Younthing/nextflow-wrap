"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Play, XCircle } from "lucide-react";

import { AsyncPlaceholder } from "@/components/ui/async-placeholder";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EDITOR_ACTIONS } from "@/features/editor/commands";
import {
  useEditorStore,
  useEditorStoreApi,
} from "@/features/editor/editor-provider";
import { useShortcutLabel } from "@/lib/use-action-shortcuts";
import { LabeledCode } from "@/features/project/components/labeled-code";
import { ProjectPreview } from "@/features/project/components/project-preview";
import { GenerateError, generateProject } from "@/features/project/generate";
import {
  executorDef,
  launchCommand,
  launchProblems,
  renderRunConfig,
  type LaunchConfig,
} from "@/features/project/launch";
import type { Issue } from "@/features/workflow/validate";
import { EnvironmentForm } from "./environment-form";
import { ProjectSettingsForm } from "@/features/project/components/project-settings-form";
import { readLaunchConfig, rememberLaunchConfig } from "../saved-launch";
import { useHealthStatus, useLaunchRun } from "../queries";

export function RunDialog({
  open,
  onOpenChange,
  issues,
  modulesSha,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issues: Issue[];
  modulesSha: string;
}) {
  const store = useEditorStoreApi();
  const params = useEditorStore((s) => s.params);
  const router = useRouter();
  const launch = useLaunchRun();
  const health = useHealthStatus(open);
  const real = !!health.data && !health.data.mocked;
  const docId = useEditorStore((s) => s.docId);
  const revision = useEditorStore((s) => s.revision);
  const saveShortcut = useShortcutLabel(EDITOR_ACTIONS.save.shortcut);
  const index = useEditorStore((s) => s.index);
  const [config, setConfig] = React.useState<LaunchConfig>(() =>
    readLaunchConfig(docId),
  );
  const launchConfig: LaunchConfig = real
    ? {
        ...config,
        settings: { cpus: 2, memory: "2.GB", ...config.settings },
        executor: "local",
        engine: "docker",
        resume: false,
      }
    : config;
  const [tab, setTab] = React.useState("environment");

  // Re-read the saved launch settings whenever the dialog opens for a workflow.
  const [openedFor, setOpenedFor] = React.useState<string | null>(null);
  if (open && openedFor !== docId) {
    setOpenedFor(docId);
    setConfig(readLaunchConfig(docId));
    setTab("environment");
  } else if (!open && openedFor !== null) {
    setOpenedFor(null);
  }

  const generated = React.useMemo(() => {
    if (!open || !index.size) return null;
    try {
      return {
        project: generateProject(store.getState().toDoc(), index, {
          modulesSha,
          registry: config.registry,
        }),
      };
    } catch (err) {
      if (err instanceof GenerateError) return { error: err.message };
      throw err;
    }
    // revision tracks every edit to the document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index, modulesSha, config.registry, revision]);

  const runConfig = renderRunConfig(launchConfig);
  const command = launchCommand(launchConfig);
  const errors = issues
    .filter((i) => i.level === "error")
    .map((i) => i.message);
  const problems = [
    ...(docId ? [] : [`请先保存流程（${saveShortcut}）`]),
    ...(generated?.error ? [`无法生成项目：${generated.error}`] : []),
    ...errors,
    ...launchProblems(launchConfig),
    ...(real && !health.data?.runnerReady
      ? [health.data?.diagnostics ?? "Runner 未就绪"]
      : []),
  ];

  const start = () => {
    if (problems.length || !generated?.project) return;
    const doc = store.getState().toDoc();
    const { project } = generated;
    rememberLaunchConfig(docId, launchConfig);
    launch.mutate(
      {
        workflow: doc,
        project: {
          name: project.meta.name,
          files: project.files.map(({ path, content }) => ({ path, content })),
          components: project.components,
        },
        params: doc.params,
        launch: launchConfig,
        modulesSha,
        runConfig,
        command,
      },
      {
        onSuccess: (run) => {
          onOpenChange(false);
          router.push(`/runs/${run.id}`);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(860px,90vh)] flex-col gap-4 sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="font-serif">运行流程</DialogTitle>
          <DialogDescription>
            画布会生成一个 nf-core 结构的 Nextflow
            项目，由后端用下面的命令启动。
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1">
          <TabsList>
            <TabsTrigger value="environment">运行环境</TabsTrigger>
            <TabsTrigger value="project">
              项目文件
              {generated?.project && ` · ${generated.project.files.length}`}
            </TabsTrigger>
            <TabsTrigger value="command">命令和配置</TabsTrigger>
          </TabsList>
          <TabsContent
            value="environment"
            className="min-h-0 overflow-auto pr-1"
          >
            <div className="grid gap-6 py-1">
              <EnvironmentForm
                config={launchConfig}
                onChange={setConfig}
                real={real}
              />
              <ProjectSettingsForm />
            </div>
          </TabsContent>
          <TabsContent value="project" className="flex min-h-0 flex-col">
            {generated?.project ? (
              <ProjectPreview
                files={generated.project.files}
                components={generated.project.components}
                className="min-h-0 flex-1"
              />
            ) : generated && "error" in generated ? (
              <AsyncPlaceholder
                status="error"
                className="flex-1"
                message={generated.error}
              />
            ) : (
              <div className="grid flex-1 place-items-center text-sm text-destructive">
                正在生成…
              </div>
            )}
          </TabsContent>
          <TabsContent
            value="command"
            className="grid min-h-0 content-start gap-4 overflow-auto"
          >
            <LabeledCode
              title="启动命令（在项目目录中执行）"
              code={command}
              language="text"
              lineNumbers={false}
            />
            <LabeledCode title="run.config（-c）" code={runConfig} language="groovy" />
            <LabeledCode
              title="params.json（-params-file）"
              code={JSON.stringify(params, null, 2)}
              language="json"
            />
          </TabsContent>
        </Tabs>

        <div className="flex items-end gap-4 border-t border-border/60 pt-4">
          <div className="min-w-0 flex-1 text-xs">
            {problems.length > 0 ? (
              <ul className="grid max-h-20 gap-1 overflow-auto">
                {problems.map((p) => (
                  <li
                    key={p}
                    className="flex items-start gap-1.5 text-destructive"
                  >
                    <XCircle className="mt-0.5 size-3.5 shrink-0" />
                    {p}
                  </li>
                ))}
              </ul>
            ) : launch.error ? (
              <span className="flex items-center gap-1.5 text-destructive">
                <AlertTriangle className="size-3.5" />
                启动失败：{launch.error.message}
              </span>
            ) : (
              <span className="font-mono text-muted-foreground">
                {executorDef(config.executor).name} · -profile{" "}
                {[config.engine, ...config.extraProfiles].join(",")}
              </span>
            )}
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            onClick={start}
            disabled={problems.length > 0 || launch.isPending}
          >
            {launch.isPending ? <Loader2 className="animate-spin" /> : <Play />}
            启动运行
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
