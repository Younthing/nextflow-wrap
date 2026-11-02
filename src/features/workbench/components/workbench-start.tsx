"use client";

import Link from "next/link";
import { Loader2, NotebookText, Plus } from "lucide-react";

import { formatRelative } from "@/features/notebook/library";
import type { NotebookSummary } from "@/features/notebook/types";
import type { Project } from "@/features/workspace/types";

const STARTERS = [
  { kernel: "py311-pandas", title: "Python 笔记本", hint: "pandas、scanpy 一类分析" },
  { kernel: "r-deseq2", title: "R 笔记本", hint: "DESeq2、Seurat 一类分析" },
] as const;

/** `/workbench` with nothing open: start a notebook or pick up a recent one. */
export function WorkbenchStart({
  project,
  notebooks,
  creating,
  onCreate,
}: {
  project: Project;
  notebooks: NotebookSummary[];
  creating?: string;
  onCreate: (kernel: string) => void;
}) {
  const recent = notebooks.slice(0, 6);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto grid max-w-3xl gap-8 px-6 py-10">
        <header className="grid gap-1">
          <h1 className="font-serif text-2xl font-bold">{project.name}</h1>
          <p className="font-mono text-xs text-muted-foreground">{project.path}</p>
        </header>
        <section aria-labelledby="workbench-new" className="grid gap-3">
          <h2 id="workbench-new" className="text-[11px] font-bold tracking-[0.1em] text-muted-foreground">新建</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {STARTERS.map((starter) => (
              <button
                key={starter.kernel}
                type="button"
                disabled={!!creating}
                onClick={() => onCreate(starter.kernel)}
                className="flex items-center gap-3 rounded-xl border border-glass-border bg-glass px-4 py-3.5 text-left transition-colors hover:bg-glass-strong focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-60"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/12 text-primary">
                  {creating === starter.kernel ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                </span>
                <span className="grid">
                  <span className="text-sm font-medium">空白 {starter.title}</span>
                  <span className="text-xs text-muted-foreground">{starter.hint}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
        {recent.length ? (
          <section aria-labelledby="workbench-recent" className="grid gap-2">
            <h2 id="workbench-recent" className="text-[11px] font-bold tracking-[0.1em] text-muted-foreground">最近编辑</h2>
            <ul className="-mx-2 grid gap-0.5">
              {recent.map((nb) => (
                <li key={nb.id}>
                  <Link href={`/workbench/${nb.id}`} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-glass-strong">
                    <NotebookText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-sm">{nb.name}</span>
                    {nb.description ? <span className="hidden max-w-64 truncate text-xs text-muted-foreground md:inline">{nb.description}</span> : null}
                    <span className="shrink-0 text-xs text-muted-foreground">{formatRelative(nb.updatedAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <p className="text-xs leading-relaxed text-muted-foreground">
          左边的「文件」就是项目文件夹，单击文件会复制它的完整路径，粘贴到单元格里就能读。分析反复要用时，可以在笔记本的「导出」里导出为模块，放进流程编排。
        </p>
      </div>
    </div>
  );
}
