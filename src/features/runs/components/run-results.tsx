"use client";

import * as React from "react";
import { BarChart3, FileText, Folder, FolderOpen, Loader2, PackageOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CodeViewer } from "@/features/project/components/code-viewer";
import { cn } from "@/lib/utils";
import { formatBytes } from "../format";
import type { ResultFile } from "../outputs";
import { useResultContent, useRunLog, useRunResults } from "../queries";

const MULTIQC = "multiqc/multiqc_report.html";

function languageOf(path: string) {
  if (path.endsWith(".json")) return "json" as const;
  if (/\.ya?ml$/.test(path)) return "yaml" as const;
  return "text" as const;
}

function Preview({ runId, file, outdir }: { runId: string; file: ResultFile; outdir: string }) {
  const content = useResultContent(runId, file.preview ? file.path : null);
  const fullPath = `${outdir.replace(/\/$/, "")}/${file.path}`;

  if (!file.preview) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <PackageOpen className="size-8" />
        <span>{file.path.endsWith("/") ? "目录" : "二进制文件"}，{formatBytes(file.size)}，无法在浏览器里预览</span>
        <code className="rounded bg-secondary px-2 py-1 font-mono text-xs">{fullPath}</code>
      </div>
    );
  }
  if (content.isPending) {
    return (
      <div className="grid flex-1 place-items-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (content.error) return <div className="p-6 text-sm text-destructive">读取失败：{content.error.message}</div>;
  if (file.preview === "html") {
    return (
      <iframe
        title={file.path}
        srcDoc={content.data.body}
        // Reports are untrusted output: no scripts or same-origin access.
        sandbox=""
        className="min-h-0 flex-1 rounded-lg border border-border bg-white"
      />
    );
  }
  return <CodeViewer code={content.data.body} language={languageOf(file.path)} className="min-h-0 flex-1" />;
}

/** Files under --outdir grouped by their first directory (one per module). */
function groupByDir(files: ResultFile[]) {
  const groups = new Map<string, ResultFile[]>();
  for (const f of files) {
    const dir = f.path.includes("/") ? f.path.slice(0, f.path.indexOf("/")) : "";
    groups.set(dir, [...(groups.get(dir) ?? []), f]);
  }
  return [...groups.entries()];
}

export function RunResults({ runId, active, outdir }: { runId: string; active: boolean; outdir: string }) {
  const results = useRunResults(runId, active);
  const files = React.useMemo(() => results.data ?? [], [results.data]);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());

  // Open the MultiQC report as soon as it exists, unless the user picked a file.
  const current = files.find((f) => f.path === selected) ?? files.find((f) => f.path === MULTIQC) ?? files[0];

  if (results.isPending) {
    return (
      <div className="grid flex-1 place-items-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!files.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <PackageOpen className="size-8" />
        {active ? "任务完成后，发布到 outdir 的文件会出现在这里" : "这次运行没有发布任何文件"}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 gap-3">
      <ScrollArea className="w-72 shrink-0 rounded-lg bg-secondary/40">
        <div className="grid gap-2 p-2">
          {files.some((f) => f.path === MULTIQC) && (
            <Button
              variant={current?.path === MULTIQC ? "default" : "outline"}
              size="sm"
              className="justify-start"
              onClick={() => setSelected(MULTIQC)}
            >
              <BarChart3 /> MultiQC 报告
            </Button>
          )}
          <ul className="text-xs" aria-label="结果文件">
            {groupByDir(files).map(([dir, group]) => {
              const isCollapsed = collapsed.has(dir);
              return (
                <li key={dir}>
                  {dir && (
                    <button
                      type="button"
                      className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-muted-foreground hover:bg-accent"
                      onClick={() =>
                        setCollapsed((prev) => {
                          const next = new Set(prev);
                          if (next.has(dir)) next.delete(dir);
                          else next.add(dir);
                          return next;
                        })
                      }
                    >
                      {isCollapsed ? <Folder className="size-3.5" /> : <FolderOpen className="size-3.5" />}
                      {dir}/<span className="ml-auto">{group.length}</span>
                    </button>
                  )}
                  {!isCollapsed && (
                    <ul>
                      {group.map((f) => (
                        <li key={f.path}>
                          <button
                            type="button"
                            onClick={() => setSelected(f.path)}
                            className={cn(
                              "flex w-full items-center gap-1.5 rounded-md py-1 pr-2 pl-6 text-left font-mono hover:bg-accent",
                              f.path === current?.path && "bg-glass-strong text-primary shadow-sm",
                            )}
                          >
                            {f.path.endsWith("/") ? <Folder className="size-3.5 shrink-0" /> : <FileText className="size-3.5 shrink-0 text-muted-foreground" />}
                            <span className="truncate">{f.path.slice(dir ? dir.length + 1 : 0)}</span>
                            <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{formatBytes(f.size)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </ScrollArea>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {current && (
          <>
            <div className="font-mono text-xs text-muted-foreground">
              {outdir.replace(/\/$/, "")}/{current.path}
            </div>
            <Preview key={current.path} runId={runId} file={current} outdir={outdir} />
          </>
        )}
      </div>
    </div>
  );
}

export function RunConsole({ runId, active }: { runId: string; active: boolean }) {
  const log = useRunLog(runId, active);
  const ref = React.useRef<HTMLDivElement>(null);
  const lines = log.data?.lines;

  // Follow the end of the log like a terminal.
  React.useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines?.length]);

  return (
    <div ref={ref} className="min-h-0 flex-1 overflow-auto rounded-lg bg-[oklch(0.2_0.02_260)] p-3 font-mono text-[12px] leading-5 text-[oklch(0.9_0.01_260)]">
      {log.isPending && <span className="opacity-60">加载日志…</span>}
      {lines?.map((line, i) => (
        <div
          key={i}
          className={cn(
            "whitespace-pre-wrap",
            /^ERROR|Pipeline completed with errors/.test(line) && "text-[oklch(0.72_0.18_25)]",
            /^WARN/.test(line) && "text-[oklch(0.82_0.14_80)]",
            /completed successfully/.test(line) && "text-[oklch(0.78_0.15_155)]",
            /^\[[0-9a-f]{2}\//.test(line) && "text-[oklch(0.8_0.06_230)]",
          )}
        >
          {line || " "}
        </div>
      ))}
    </div>
  );
}
