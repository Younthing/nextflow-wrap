"use client";

import Link from "next/link";

import { useKernelInfo, useKernelSpecs } from "@/features/notebook/queries";
import type { KernelState, NotebookSummary } from "@/features/notebook/types";
import { runtimeRows } from "@/features/workbench/runtimes";
import { cn } from "@/lib/utils";

const DOT: Record<KernelState, string> = {
  stopped: "bg-muted-foreground/40",
  starting: "bg-warning",
  idle: "bg-success",
  busy: "bg-warning",
  dead: "bg-destructive",
};

/** Left column, bottom: the runtimes notebooks run on. The open notebook's kernel shows its live state. */
export function WorkbenchRuntimes({ notebooks, active }: { notebooks: NotebookSummary[]; active?: NotebookSummary }) {
  const specs = useKernelSpecs();
  const info = useKernelInfo(active?.id ?? "", !!active && active.language === "python");
  const rows = runtimeRows(notebooks, specs.data?.kernels ?? []);
  const activeState: KernelState = info.data?.state ?? "stopped";
  return (
    <section aria-labelledby="workbench-runtimes" className="grid gap-0.5 border-t border-border px-1 pt-3">
      <div className="flex items-center px-1.5 pb-1">
        <h2 id="workbench-runtimes" className="text-[11px] font-bold tracking-[0.1em] text-muted-foreground">运行时</h2>
        <Link href="/settings" className="ml-auto text-xs text-primary hover:underline">管理</Link>
      </div>
      {/* Focusable so the list can be scrolled from the keyboard when there are many kernels. */}
      <ul aria-label="可用的运行时" tabIndex={0} className="grid max-h-48 gap-0.5 overflow-y-auto rounded-lg focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none">
        {rows.map((row) => {
          const current = row.name === active?.kernel;
          return (
            <li key={row.name} className={cn("flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[12.5px]", current && "bg-glass-strong shadow-sm")}>
              <span className={cn("size-[7px] shrink-0 rounded-full", current ? DOT[activeState] : row.users ? "bg-muted-foreground/50" : "bg-muted-foreground/25")} aria-hidden />
              <span className="grid min-w-0">
                <span className={cn("truncate", current && "font-medium")}>{row.label}</span>
                <span className="truncate text-[11px] text-muted-foreground">
                  {current ? `当前笔记本 · ${STATE_LABEL[activeState]}` : row.users ? `${row.users} 个笔记本在用` : "空闲"}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      {specs.data && !specs.data.available ? (
        <p className="px-2 pt-1 text-[11px] leading-relaxed text-muted-foreground">未检测到 Jupyter</p>
      ) : null}
    </section>
  );
}

const STATE_LABEL: Record<KernelState, string> = {
  stopped: "未启动",
  starting: "启动中",
  idle: "空闲",
  busy: "运行中",
  dead: "已退出",
};
