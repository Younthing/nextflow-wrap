"use client";

import * as React from "react";
import Link from "next/link";
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, History, Loader2, Square, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { executorDef } from "@/features/project/launch";
import { cn } from "@/lib/utils";
import { formatDuration, formatTime, RUN_STATUS, runDuration } from "../format";
import { isActive, useCancelRun, useDeleteRun, useRuns } from "../queries";
import type { RunProgress, RunSummary } from "../types";

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text, datetime: sortFn_datetime },
});
const helper = createColumnHelper<typeof features, RunSummary>();

export function StatusBadge({ status }: { status: RunSummary["status"] }) {
  const s = RUN_STATUS[status];
  return (
    <Badge variant={s.variant}>
      {isActive(status) && <Loader2 className="animate-spin" />}
      {s.label}
    </Badge>
  );
}

export function ProgressBar({ progress, className }: { progress: RunProgress; className?: string }) {
  const pct = (n: number) => (progress.total ? `${(n / progress.total) * 100}%` : "0%");
  return (
    <div className={cn("flex h-1.5 overflow-hidden rounded-full bg-secondary", className)}>
      <div className="bg-success transition-[width] duration-500" style={{ width: pct(progress.completed + progress.cached) }} />
      <div className="bg-destructive transition-[width] duration-500" style={{ width: pct(progress.failed) }} />
      <div className="bg-warning transition-[width] duration-500" style={{ width: pct(progress.aborted) }} />
      <div className="animate-pulse bg-primary transition-[width] duration-500" style={{ width: pct(progress.running) }} />
    </div>
  );
}

function RowActions({ run }: { run: RunSummary }) {
  const cancel = useCancelRun();
  const del = useDeleteRun();
  return (
    <div className="flex justify-end gap-1">
      {isActive(run.status) ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`停止 ${run.runName}`}
          disabled={cancel.isPending}
          onClick={() => cancel.mutate(run.id)}
        >
          <Square className="text-destructive" />
        </Button>
      ) : (
        <Button variant="ghost" size="icon-sm" aria-label={`删除 ${run.runName}`} disabled={del.isPending} onClick={() => del.mutate(run.id)}>
          <Trash2 className="text-muted-foreground" />
        </Button>
      )}
    </div>
  );
}

const columns = helper.columns([
  helper.accessor("status", {
    header: "状态",
    cell: (info) => <StatusBadge status={info.getValue()} />,
    sortFn: "text",
  }),
  helper.accessor("runName", {
    header: "运行",
    sortFn: "alphanumeric",
    cell: (info) => (
      <Link href={`/runs/${info.row.original.id}`} className="font-mono font-medium text-primary hover:underline">
        {info.getValue()}
      </Link>
    ),
  }),
  helper.accessor("workflowName", { header: "流程", sortFn: "text" }),
  helper.accessor("executor", {
    header: "运行环境",
    sortFn: "text",
    cell: (info) => (
      <div className="grid">
        <span>{executorDef(info.getValue()).name}</span>
        <span className="font-mono text-[11px] text-muted-foreground">-profile {info.row.original.profile}</span>
      </div>
    ),
  }),
  helper.accessor((r) => (r.progress.total ? (r.progress.completed + r.progress.cached) / r.progress.total : 0), {
    id: "progress",
    header: "进度",
    cell: (info) => {
      const p = info.row.original.progress;
      return (
        <div className="grid w-36 gap-1">
          <ProgressBar progress={p} />
          <span className="font-mono text-[11px] text-muted-foreground">
            已发现 {p.total} · 完成 {p.completed + p.cached}{p.failed > 0 && ` · ${p.failed} 失败`}
            {p.aborted > 0 && ` · ${p.aborted} 中止`}
          </span>
        </div>
      );
    },
  }),
  helper.accessor((r) => new Date(r.submittedAt), {
    id: "submittedAt",
    header: "提交时间",
    sortFn: "datetime",
    cell: (info) => <span className="text-muted-foreground">{formatTime(info.row.original.submittedAt)}</span>,
  }),
  helper.accessor((r) => runDuration(r) ?? -1, {
    id: "duration",
    header: "耗时",
    cell: (info) => <span className="font-mono">{formatDuration(runDuration(info.row.original))}</span>,
  }),
  helper.display({
    id: "actions",
    header: () => <span className="sr-only">操作</span>,
    cell: (info) => <RowActions run={info.row.original} />,
  }),
]);

const EMPTY: RunSummary[] = [];

export function RunsTable({ workflowId }: { workflowId?: string }) {
  const runs = useRuns(workflowId);
  const table = useTable({
    features,
    columns,
    data: runs.data ?? EMPTY,
    initialState: { sorting: [{ id: "submittedAt", desc: true }] },
    getRowId: (r) => r.id,
  });

  if (runs.isPending) {
    return (
      <div className="grid h-40 place-items-center text-sm text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }
  if (runs.error) {
    return <div className="p-6 text-sm text-destructive">加载运行记录失败：{runs.error.message}</div>;
  }
  if (!runs.data?.length) {
    return (
      <div className="flex h-60 flex-col items-center justify-center gap-2 text-muted-foreground">
        <History className="size-8" />
        <p className="text-sm">还没有运行记录</p>
        <Button asChild variant="outline" size="sm">
          <Link href="/workflows">去流程库</Link>
        </Button>
      </div>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead>
        {table.getHeaderGroups().map((group) => (
          <tr key={group.id} className="border-b border-border/60 text-left text-xs text-muted-foreground">
            {group.headers.map((header) => {
              const sorted = header.column.getIsSorted();
              const SortIcon = sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ArrowUpDown;
              return (
                <th key={header.id} className="px-3 py-2 font-medium" aria-sort={sorted ? (sorted === "asc" ? "ascending" : "descending") : undefined}>
                  {header.isPlaceholder ? null : header.column.getCanSort() ? (
                    <button type="button" className="group flex items-center gap-1 hover:text-foreground" onClick={header.column.getToggleSortingHandler()}>
                      <table.FlexRender header={header} />
                      <SortIcon className={cn("size-3", !sorted && "opacity-0 group-hover:opacity-60")} />
                    </button>
                  ) : (
                    <table.FlexRender header={header} />
                  )}
                </th>
              );
            })}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map((row) => (
          <tr key={row.id} className="border-b border-border/40 transition-colors last:border-0 hover:bg-accent/50">
            {row.getAllCells().map((cell) => (
              <td key={cell.id} className="px-3 py-2.5 align-middle">
                <table.FlexRender cell={cell} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
