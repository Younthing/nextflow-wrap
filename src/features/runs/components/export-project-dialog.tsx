"use client";

import * as React from "react";
import { Download } from "lucide-react";

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
import {
  useEditorStore,
  useEditorStoreApi,
} from "@/features/editor/editor-provider";
import { LabeledCode } from "@/features/project/components/labeled-code";
import { ProjectPreview } from "@/features/project/components/project-preview";
import { launchCommand, renderRunConfig } from "@/features/project/launch";
import { useSettings } from "@/features/settings/queries";
import { launchParams } from "@/features/workflow/inputs";
import { saveTextFile } from "@/lib/save-file";
import { toast } from "@/lib/toast";
import { zipFiles } from "@/lib/zip";
import { effectiveLaunchConfig, generateFor } from "../launch-request";
import { useHealthStatus } from "../queries";
import { readLaunchConfig } from "../saved-launch";

/** The standard Nextflow project the canvas turns into, to read or take elsewhere. */
export function ExportProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const store = useEditorStoreApi();
  const docId = useEditorStore((s) => s.docId);
  const revision = useEditorStore((s) => s.revision);
  const index = useEditorStore((s) => s.index);
  const health = useHealthStatus(open);
  const real = !!health.data && !health.data.mocked;
  const settings = useSettings();
  const [tab, setTab] = React.useState("project");

  const launchConfig = React.useMemo(
    () => (open ? effectiveLaunchConfig(readLaunchConfig(docId), settings.data?.settings.remotes, real) : null),
    [open, docId, settings.data, real],
  );

  const generated = React.useMemo(() => {
    if (!open || !index.size || !launchConfig) return null;
    const doc = store.getState().toDoc();
    return { doc, ...generateFor(doc, index, launchConfig.registry) };
    // revision tracks every edit to the document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index, launchConfig, revision]);

  const project = generated?.project;
  const command = launchConfig ? launchCommand(launchConfig) : "";
  const runConfig = launchConfig ? renderRunConfig(launchConfig) : "";
  const params = generated ? launchParams(generated.doc) : {};

  const download = () => {
    if (!project) return;
    const root = project.meta.name;
    const files = [
      ...project.files.map((file) => ({ path: `${root}/${file.path}`, content: file.content })),
      { path: `${root}/run.config`, content: runConfig },
      { path: `${root}/params.json`, content: `${JSON.stringify(params, null, 2)}\n` },
    ];
    try {
      saveTextFile(`${root}.zip`, "application/zip", zipFiles(files));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "导出失败");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(860px,90vh)] flex-col gap-4 sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="font-serif">导出 Nextflow 项目</DialogTitle>
          <DialogDescription>
            画布对应的标准 Nextflow 项目。下载后在项目目录里执行下面的命令，也能在别的机器上跑。
          </DialogDescription>
        </DialogHeader>

        <LabeledCode
          title="启动命令（在项目目录中执行）"
          code={command}
          language="text"
          lineNumbers={false}
        />

        <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1">
          <TabsList>
            <TabsTrigger value="project">
              项目文件
              {project && ` · ${project.files.length}`}
            </TabsTrigger>
            <TabsTrigger value="command">命令和配置</TabsTrigger>
          </TabsList>
          <TabsContent value="project" className="flex min-h-0 flex-col">
            {project ? (
              <ProjectPreview files={project.files} className="min-h-0 flex-1" />
            ) : generated?.error ? (
              <AsyncPlaceholder status="error" className="flex-1" message={generated.error} />
            ) : (
              <div className="grid flex-1 place-items-center text-sm text-muted-foreground">
                正在生成…
              </div>
            )}
          </TabsContent>
          <TabsContent
            value="command"
            className="grid min-h-0 content-start gap-4 overflow-auto"
          >
            <LabeledCode title="run.config（-c）" code={runConfig} language="groovy" />
            <LabeledCode
              title="params.json（-params-file）"
              code={JSON.stringify(params, null, 2)}
              language="json"
            />
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-3 border-t border-border/60 pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
          <Button onClick={download} disabled={!project}>
            <Download />
            下载 .zip
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
