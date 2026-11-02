"use client";

import Link from "next/link";
import { Loader2, NotebookText, Plus } from "lucide-react";

import { defaultKernel } from "@/features/notebook/kernel-choices";
import { formatRelative } from "@/features/notebook/library";
import type { NotebookLanguage, NotebookSummary } from "@/features/notebook/types";
import { mockingActive } from "@/lib/mocking";
import type { Project } from "@/features/workspace/types";

const STARTERS: { language: NotebookLanguage; title: string }[] = [
  { language: "python", title: "Python 笔记本" },
  { language: "r", title: "R 笔记本" },
];

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
            {STARTERS.map((starter) => ({ ...starter, kernel: defaultKernel(starter.language, mockingActive()) })).map((starter) => (
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
                <span className="text-sm font-medium">空白 {starter.title}</span>
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
      </div>
    </div>
  );
}
