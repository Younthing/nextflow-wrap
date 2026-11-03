"use client";

import * as React from "react";
import { AlertTriangle, Loader2, Play, RotateCcw, XCircle } from "lucide-react";

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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issues: Issue[];
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

  // Re-read the saved launch settings whenever the dialog opens for a workflow.
  const [openedFor, setOpenedFor] = React.useState<string | null>(null);
  if (open && openedFor !== docId) {
    setOpenedFor(docId);
    setConfig(readLaunchConfig(docId));
  } else if (!open && openedFor !== null) {
    setOpenedFor(null);
  }

  const generated = React.useMemo(() => {
    if (!open || !index.size) return null;
    return generateFor(store.getState().toDoc(), index, launchConfig.registry);
    // revision tracks every edit to the document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index, launchConfig.registry, revision]);

  const command = launchCommand(launchConfig);
  const problems = [
    ...setupProblems({ docId, saveShortcut, generated, launch: launchConfig, health: health.data }),
    ...issues.filter((i) => i.level === "error").map((i) => i.message),
  ];

  // One-click resume: the latest finished run of this workflow whose cache is still on disk.
  const runs = useRuns(docId || undefined, { enabled: open && Boolean(docId) });
  const resumeSource = runs.data?.find((run) => run.resumable);

  const start = (resumeFrom?: string) => {
    if (problems.length || !generated?.project) return;
    startRun.start(
      { doc: store.getState().toDoc(), project: generated.project, config: launchConfig, resumeFrom },
      () => onOpenChange(false),
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-4 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-serif">运行设置</DialogTitle>
          <DialogDescription>
            工具栏的「运行」会直接用这里保存的设置启动。
          </DialogDescription>
        </DialogHeader>

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

        <div className="flex flex-wrap items-end gap-3 border-t border-border/60 pt-4">
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
            ) : startRun.error ? (
              <span className="flex items-center gap-1.5 text-destructive">
                <AlertTriangle className="size-3.5" />
                启动失败：{startRun.error.message}
              </span>
            ) : (
              <span className="font-mono text-muted-foreground">
                {executorDef(launchConfig.executor).name}
                {profileList(launchConfig)
                  ? ` · -profile ${profileList(launchConfig)}`
                  : ` · ${launchConfig.engine === "zsh" ? "Zsh" : launchConfig.engine === "bash" ? "Bash" : "Shell"}`}
              </span>
            )}
          </div>
          <Button
            variant="outline"
            onClick={() => {
              rememberLaunchConfig(docId, launchConfig);
              onOpenChange(false);
            }}
          >
            保存设置
          </Button>
          {resumeSource && (
            <Button
              variant="glass"
              onClick={() => start(resumeSource.id)}
              disabled={problems.length > 0 || startRun.pending}
              title={`用 -resume 复用 ${resumeSource.runName} 的缓存：没改动的步骤直接跳过`}
            >
              <RotateCcw />
              续跑
            </Button>
          )}
          <Button
            onClick={() => start()}
            disabled={problems.length > 0 || startRun.pending}
          >
            {startRun.pending ? <Loader2 className="animate-spin" /> : <Play />}
            启动运行
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
