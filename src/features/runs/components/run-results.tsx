"use client";

import * as React from "react";
import { BarChart3, FileText, Folder, FolderOpen, PackageOpen } from "lucide-react";

import { AsyncPlaceholder } from "@/components/ui/async-placeholder";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { OutputRenderer } from "@/features/output/output-renderer";
import { viewFromText, type OutputView } from "@/features/output/model";
import { cn } from "@/lib/utils";
import { formatBytes } from "../format";
import type { ResultFile } from "../outputs";
import { firstPreviewable, imageMime, isBinaryPreview } from "../preview";
import { useHealthStatus, useResultBlob, useResultContent, useRunLog, useRunResults } from "../queries";
import { staticReportHtml } from "../report-preview";

const MULTIQC = "multiqc/multiqc_report.html";

function DirectoryPlaceholder({ path, description }: { path: string; description: string }) {
  return (
    <AsyncPlaceholder status="empty" className="flex-1" icon={<FolderOpen />} description={description}>
      <code className="rounded bg-secondary px-2 py-1 font-mono text-xs">{path}</code>
    </AsyncPlaceholder>
  );
}

function BlobPreview({ blob, view }: { blob: Blob; view: (src: string) => OutputView }) {
  const src = React.useMemo(() => URL.createObjectURL(blob), [blob]);
  React.useEffect(() => () => URL.revokeObjectURL(src), [src]);
  return <OutputRenderer view={view(src)} className="min-h-0 flex-1" />;
}

function Preview({ runId, file, outdir }: { runId: string; file: ResultFile; outdir: string }) {
  const binary = isBinaryPreview(file.preview);
  const textual = file.preview === "html" || file.preview === "markdown" || file.preview === "csv" || file.preview === "tsv" || file.preview === "text";
  const content = useResultContent(runId, textual ? file.path : null);
  const blob = useResultBlob(runId, binary ? file.path : null);
  const fullPath = `${outdir.replace(/\/$/, "")}/${file.path}`;
  const reportHtml = React.useMemo(
    () => (file.preview === "html" && content.data ? staticReportHtml(content.data.body) : ""),
    [file.preview, content.data],
  );

  if (!file.preview) {
    if (file.path.endsWith("/")) return <DirectoryPlaceholder path={fullPath} description="这是一个目录。打开其中的文件后再预览。" />;
    return (
      <AsyncPlaceholder
        status="empty"
        className="flex-1"
        icon={<PackageOpen />}
        description={`二进制文件，${formatBytes(file.size)}，无法在浏览器里预览`}
      >
        <code className="rounded bg-secondary px-2 py-1 font-mono text-xs">{fullPath}</code>
      </AsyncPlaceholder>
    );
  }
  const pending = binary ? blob.isPending : content.isPending;
  const error = binary ? blob.error : content.error;
  if (pending) return <AsyncPlaceholder status="pending" className="flex-1" />;
  if (error) {
    return <AsyncPlaceholder status="error" className="h-auto" message={`读取失败：${error.message}`} />;
  }
  if (binary && blob.data) {
    const mime = imageMime(file.preview);
    return (
      <BlobPreview
        blob={blob.data}
        view={(src) => mime
          ? { kind: "image", mime, src, alt: file.path }
          : { kind: "pdf", src, title: file.path }}
      />
    );
  }
  if (!content.data) return <AsyncPlaceholder status="pending" className="flex-1" />;
  if (file.preview === "html") {
    return <OutputRenderer view={{ kind: "html-document", html: reportHtml, title: file.path }} className="min-h-0 flex-1" />;
  }
  if (file.preview === "markdown" || file.preview === "csv" || file.preview === "tsv" || file.preview === "text") {
    return <OutputRenderer view={viewFromText(file.preview, content.data.body)} className="min-h-0 flex-1" />;
  }
  return <AsyncPlaceholder status="pending" className="flex-1" />;
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
  const health = useHealthStatus();
  const results = useRunResults(runId, active);
  const files = React.useMemo(() => results.data ?? [], [results.data]);
  const [chosen, setChosen] = React.useState<string | null>(null);
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());
  const picked = chosen ? files.find((file) => file.path === chosen) : undefined;
  const fallback = firstPreviewable(files);
  // Keep the first previewable file until the reader picks one, including after the list grows.
  if (!picked && fallback && chosen !== fallback.path) setChosen(fallback.path);
  const current = picked ?? fallback;

  if (results.isPending) {
    return <AsyncPlaceholder status="pending" className="flex-1" />;
  }
  if (!files.length) {
    return (
      <AsyncPlaceholder
        status="empty"
        className="flex-1"
        icon={<PackageOpen />}
        description={active ? "任务完成后，发布到 outdir 的文件会出现在这里" : "这次运行没有发布任何文件"}
      />
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
              onClick={() => setChosen(MULTIQC)}
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
                            onClick={() => setChosen(f.path)}
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
      <div className="flex min-w-0 flex-1 flex-col gap-1.5" aria-label="结果预览">
        {current ? (
          <>
            <div className="font-mono text-xs text-muted-foreground">
              {outdir.replace(/\/$/, "")}/{current.path}
            </div>
            {health.data?.mocked === false && <Button asChild variant="outline" size="sm" className="self-start"><a href={`/api/runs/${runId}/results/content?download=1&path=${encodeURIComponent(current.path)}`}>下载原始文件</a></Button>}
            {current.preview === "html" && <p className="text-xs text-muted-foreground">静态预览；交互图表请下载报告后查看。</p>}
            <Preview key={current.path} runId={runId} file={current} outdir={outdir} />
          </>
        ) : (
          <DirectoryPlaceholder path={outdir} description="这个目录里还没有可预览的文件" />
        )}
      </div>
    </div>
  );
}

export function RunConsole({ runId, active }: { runId: string; active: boolean }) {
  const health = useHealthStatus();
  const log = useRunLog(runId, active);
  const ref = React.useRef<HTMLDivElement>(null);
  const lines = log.data?.lines;

  // Follow the end of the log like a terminal.
  React.useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines?.length]);

  return (
    <><div className="flex justify-end pb-2">{health.data?.mocked === false && <Button asChild variant="outline" size="sm"><a href={`/api/runs/${runId}/log?download=1`}>下载完整日志</a></Button>}</div>
    <div ref={ref} className="min-h-0 flex-1 overflow-auto rounded-lg bg-console p-3 font-mono text-[12px] leading-5 text-console-foreground">
      {log.isPending && <span className="opacity-60">加载日志…</span>}
      {lines?.map((line, i) => (
        <div
          key={i}
          className={cn(
            "whitespace-pre-wrap",
            /^ERROR|Pipeline completed with errors/.test(line) && "text-console-error",
            /^WARN/.test(line) && "text-console-warning",
            /completed successfully/.test(line) && "text-console-success",
            /^\[[0-9a-f]{2}\//.test(line) && "text-console-task",
          )}
        >
          {line || " "}
        </div>
      ))}
    </div></>
  );
}
