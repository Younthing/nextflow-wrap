"use client";

import Link from "next/link";
import { ClipboardCopy, ExternalLink, FolderSearch, NotebookText, Workflow } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useModuleCatalog } from "@/features/workflow/queries";
import type { WorkflowDoc } from "@/features/workflow/types";
import { desktop } from "@/lib/desktop";
import { toast } from "@/lib/toast";
import { notebookSnippet, traceResult } from "../trace";
import type { ResultFile, TaskRecord } from "../types";

/**
 * Under a result preview: which node, module version and notebook revision produced the file, and actions that
 * take it further (Finder, the default app, a snippet that loads it in a notebook).
 */
export function ResultSource({ file, fullPath, workflow, tasks }: { file: ResultFile; fullPath: string; workflow?: WorkflowDoc; tasks: TaskRecord[] }) {
  const catalog = useModuleCatalog();
  const source = workflow ? traceResult(file, workflow, catalog.data?.index, tasks) : undefined;
  const bridge = desktop();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label="结果来源">
      {source && (
        <>
          <span className="inline-flex items-center gap-1">
            <Workflow className="size-3.5" aria-hidden="true" />
            <Link href={`/workflows/${workflow!.id}`} className="font-mono hover:underline">{source.alias}</Link>
            {source.moduleName && <span>· {source.moduleName}{source.version ? ` ${source.version}` : ""}</span>}
          </span>
          {source.notebook && (
            <Link href={`/notebooks/${source.notebook.id}${source.notebook.rev ? `?rev=${source.notebook.rev}` : ""}`} className="inline-flex items-center gap-1 hover:underline">
              <NotebookText className="size-3.5" aria-hidden="true" />
              源笔记本{source.notebook.rev ? ` r${source.notebook.rev}` : ""}
            </Link>
          )}
          {source.tasks.length > 0 && (
            <span className="font-mono" title={source.tasks.map((task) => `${task.name} ${task.workdir}`).join("\n")}>
              任务 {source.tasks.slice(0, 3).map((task) => task.hash).join("、")}{source.tasks.length > 3 ? ` 等 ${source.tasks.length} 个` : ""}
            </span>
          )}
        </>
      )}
      <span className="ml-auto flex gap-1">
        {bridge && (
          <>
            <Button size="sm" variant="ghost" className="h-7" onClick={() => void bridge.showItemInFolder(fullPath)}>
              <FolderSearch />{bridge.platform === "darwin" ? "在 Finder 中显示" : "在文件夹中显示"}
            </Button>
            <Button size="sm" variant="ghost" className="h-7" onClick={() => void bridge.openPath(fullPath).then((error) => { if (error) toast.error(error); })}>
              <ExternalLink />用默认程序打开
            </Button>
          </>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-7"
          onClick={() => void navigator.clipboard.writeText(notebookSnippet(fullPath)).then(() => toast.success("已复制读取这个文件的代码，粘贴到笔记本的单元格里继续分析"), () => toast.error("无法写入剪贴板"))}
        >
          <ClipboardCopy />带回笔记本
        </Button>
      </span>
    </div>
  );
}
