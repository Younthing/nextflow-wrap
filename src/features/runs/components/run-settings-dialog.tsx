"use client";

import * as React from "react";
import { ArrowLeft, Loader2, Play, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EDITOR_ACTIONS } from "@/features/editor/commands";
import {
  useEditorStore,
  useEditorStoreApi,
} from "@/features/editor/editor-provider";
import { useShortcutLabel } from "@/lib/use-action-shortcuts";
import { LabeledCode } from "@/features/project/components/labeled-code";
import { ProjectSettingsForm } from "@/features/project/components/project-settings-form";
import {
  executorDef,
  launchCommand,
  profileList,
  type LaunchConfig,
} from "@/features/project/launch";
import type { Issue } from "@/features/workflow/validate";
import { useSettings } from "@/features/settings/queries";
import { SetupWizard } from "@/features/setup/components/setup-wizard";
import { EnvironmentForm } from "./environment-form";
import { effectiveLaunchConfig, generateFor, setupProblems } from "../launch-request";
import { readLaunchConfig, rememberLaunchConfig } from "../saved-launch";
import { useHealthStatus, useRuns } from "../queries";
import { useStartRun } from "../use-start-run";

/**
 * Where and how the canvas runs. The toolbar's 运行 button starts with what is saved
 * here; this dialog changes it, and can start or resume a run on the spot.
 */
export function RunSettingsDialog({
  open,
  onOpenChange,
  issues,
  launchError,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issues: Issue[];
  launchError?: string;
}) {
  const store = useEditorStoreApi();
  const health = useHealthStatus(open);
  const real = !!health.data && !health.data.mocked;
  const docId = useEditorStore((s) => s.docId);
  const revision = useEditorStore((s) => s.revision);
  const saveShortcut = useShortcutLabel(EDITOR_ACTIONS.save.shortcut);
  const index = useEditorStore((s) => s.index);
  const [saved, setConfig] = React.useState<LaunchConfig>(() =>
    readLaunchConfig(docId),
  );
  const settings = useSettings();
  const remotes = settings.data?.settings.remotes;
  const launchConfig = effectiveLaunchConfig(saved, remotes, real);
  const startRun = useStartRun();
  const [checkingEnvironment, setCheckingEnvironment] = React.useState(false);

  // Re-read the saved launch settings whenever the dialog opens for a workflow.
  const [openedFor, setOpenedFor] = React.useState<string | null>(null);
  if (open && openedFor !== docId) {
    setOpenedFor(docId);
    setConfig(readLaunchConfig(docId));
  } else if (!open && openedFor !== null) {
    setOpenedFor(null);
    setCheckingEnvironment(false);
  }

  const generated = React.useMemo(() => {
    if (!open || !index.size) return null;
    return generateFor(store.getState().toDoc(), index, launchConfig.registry);
    // revision tracks every edit to the document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index, launchConfig.registry, revision]);

  const command = launchCommand(launchConfig);
  const environmentBlocked = health.isError || (real && !health.data?.runnerReady);
  const waitingForHealth = health.isPending;
  const problems = [
    ...(health.isError ? ["无法连接运行服务，请检查服务是否已启动。"] : []),
    ...setupProblems({ docId, saveShortcut, generated, launch: launchConfig, health: health.data }),
    ...issues.filter((i) => i.level === "error").map((i) => i.message),
  ];
  const blocked = waitingForHealth || problems.length > 0 || !generated?.project;
  const error = startRun.error?.message ?? launchError;
  const close = () => {
    if (startRun.error) startRun.reset();
    onOpenChange(false);
  };

  // One-click resume: the latest finished run of this workflow whose cache is still on disk.
  const runs = useRuns(docId || undefined, { enabled: open && Boolean(docId) });
  const resumeSource = runs.data?.find((run) => run.resumable);

  const start = (resumeFrom?: string) => {
    if (blocked || !generated?.project) return;
    startRun.start(
      { doc: store.getState().toDoc(), project: generated.project, config: launchConfig, resumeFrom },
      close,
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => next ? onOpenChange(true) : close()}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-4 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-serif">{checkingEnvironment ? "检查运行环境" : "运行设置"}</DialogTitle>
          <DialogDescription>
            {checkingEnvironment ? "检查完成后可以回到当前流程继续运行。" : "工具栏的「运行」会直接用这里保存的设置启动。"}
          </DialogDescription>
        </DialogHeader>

        {checkingEnvironment ? (
          <>
            <div className="min-h-0 overflow-auto">
              <SetupWizard embedded />
            </div>
            <Button className="self-start" variant="outline" onClick={() => {
              setCheckingEnvironment(false);
              void health.refetch();
            }}>
              <ArrowLeft /> 返回运行设置
            </Button>
          </>
        ) : (
          <>
            {(waitingForHealth || problems.length > 0 || error) && (
              <div className="grid shrink-0 gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                {waitingForHealth ? <p role="status">正在检查运行环境…</p> : null}
                {problems.length > 0 || error ? (
                  <div role="alert" className="grid gap-1 text-destructive">
                    <p className="font-medium">{problems.length ? "运行前需要处理" : "启动失败"}</p>
                    <ul className="grid max-h-24 gap-1 overflow-auto text-xs">
                      {problems.map((problem, index) => <li key={`${index}-${problem}`}>{problem}</li>)}
                      {error && <li>{error}</li>}
                    </ul>
                  </div>
                ) : null}
                {(environmentBlocked || error) && (
                  <Button size="sm" variant="outline" className="justify-self-start" onClick={() => setCheckingEnvironment(true)}>
                    检查环境
                  </Button>
                )}
              </div>
            )}
            <div className="grid min-h-0 gap-6 overflow-auto py-1 pr-1">
              <EnvironmentForm
                config={launchConfig}
                onChange={setConfig}
                real={real}
                remotes={remotes}
              />
              <ProjectSettingsForm />
              <LabeledCode
                title="启动命令（在项目目录中执行）"
                code={command}
                language="text"
                lineNumbers={false}
              />
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-border/60 pt-4">
              <p className="min-w-0 flex-1 font-mono text-xs text-muted-foreground">
                {executorDef(launchConfig.executor).name}
                {profileList(launchConfig)
                  ? ` · -profile ${profileList(launchConfig)}`
                  : ` · ${launchConfig.engine === "zsh" ? "Zsh" : launchConfig.engine === "bash" ? "Bash" : "Shell"}`}
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  rememberLaunchConfig(docId, launchConfig);
                  close();
                }}
              >
                保存设置
              </Button>
              {resumeSource && (
                <Button
                  variant="glass"
                  onClick={() => start(resumeSource.id)}
                  disabled={blocked || startRun.pending}
                  title={`用 -resume 复用 ${resumeSource.runName} 的缓存：没改动的步骤直接跳过`}
                >
                  <RotateCcw />
                  续跑
                </Button>
              )}
              <Button
                onClick={() => start()}
                disabled={blocked || startRun.pending}
              >
                {startRun.pending ? <Loader2 className="animate-spin" /> : <Play />}
                启动运行
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
