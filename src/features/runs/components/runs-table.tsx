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
import { History, Trash2 } from "lucide-react";

import { AsyncPlaceholder } from "@/components/ui/async-placeholder";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  SortHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { executorDef } from "@/features/project/launch";
import { formatDuration, formatTime, runDuration } from "../format";
import { isActive, useCancelRun, useDeleteRun, useHealthStatus, useRuns } from "../queries";
import type { RunSummary } from "../types";

import { ProgressBar, ProgressSummary, StatusBadge } from "./run-status";
import { StopRunButton } from "./stop-run-button";

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    text: sortFn_text,
    datetime: sortFn_datetime,
  },
});
const helper = createColumnHelper<typeof features, RunSummary>();

function RowActions({ run }: { run: RunSummary }) {
  const cancel = useCancelRun();
  const del = useDeleteRun();
  return (
    <div className="flex justify-end gap-1">
      {isActive(run.status) ? (
        <StopRunButton
          runName={run.runName}
          pending={cancel.isPending}
          onStop={() => cancel.mutate(run.id)}
        />
      ) : (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`删除 ${run.runName}`}
          disabled={del.isPending}
          onClick={() => del.mutate(run.id)}
        >
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
      <Link
        href={`/runs/${info.row.original.id}`}
        className="font-mono font-medium text-primary hover:underline"
      >
        {info.getValue()}
      </Link>
    ),
  }),
  helper.accessor("workflowName", { header: "流程", sortFn: "text" }),
  helper.accessor("executor", {
    header: "运行环境",
    sortFn: "text",
    cell: (info) => <ExecutorCell executor={info.getValue()} profile={info.row.original.profile} />,
  }),
  helper.accessor(
    (r) =>
      r.progress.total
        ? (r.progress.completed + r.progress.cached) / r.progress.total
        : 0,
    {
      id: "progress",
      header: "进度",
      cell: (info) => {
        const p = info.row.original.progress;
        return (
          <div className="grid w-36 gap-1">
            <ProgressBar progress={p} />
            <span className="font-mono text-[11px] text-muted-foreground">
              <ProgressSummary progress={p} />
            </span>
          </div>
        );
      },
    },
  ),
  helper.accessor((r) => new Date(r.submittedAt), {
    id: "submittedAt",
    header: "提交时间",
    sortFn: "datetime",
    cell: (info) => (
      <span className="text-muted-foreground">
        {formatTime(info.row.original.submittedAt)}
      </span>
    ),
  }),
  helper.accessor((r) => runDuration(r) ?? -1, {
    id: "duration",
    header: "耗时",
    cell: (info) => (
      <span className="font-mono">
        {formatDuration(runDuration(info.row.original))}
      </span>
    ),
  }),
  helper.display({
    id: "actions",
    header: () => <span className="sr-only">操作</span>,
    cell: (info) => <RowActions run={info.row.original} />,
  }),
]);

function ExecutorCell({ executor, profile }: { executor: RunSummary["executor"]; profile: string }) {
  const health = useHealthStatus();
  return (
    <div className="grid">
      <span className="flex items-center gap-1.5">
        {executorDef(executor).name}
        {health.data?.mocked && <Badge variant="warning">预览</Badge>}
      </span>
      <span className="font-mono text-[11px] text-muted-foreground">
        -profile {profile}
      </span>
    </div>
  );
}

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
    return <AsyncPlaceholder status="pending" className="h-40" />;
  }
  if (runs.error) {
    return (
      <AsyncPlaceholder
        status="error"
        className="h-auto"
        message={`加载运行记录失败：${runs.error.message}`}
      />
    );
  }
  if (!runs.data?.length) {
    return (
      <AsyncPlaceholder
        status="empty"
        className="h-60"
        icon={<History />}
        description="还没有运行记录"
      >
        <Button asChild variant="outline" size="sm">
          <Link href="/workflows">去流程库</Link>
        </Button>
      </AsyncPlaceholder>
    );
  }

  return (
    <Table>
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id}>
            {group.headers.map((header) => {
              const sorted = header.column.getIsSorted();
              const canSort = header.column.getCanSort();
              return (
                <TableHead
                  key={header.id}
                  aria-sort={
                    canSort
                      ? sorted === "asc"
                        ? "ascending"
                        : sorted === "desc"
                          ? "descending"
                          : "none"
                      : undefined
                  }
                >
                  {header.isPlaceholder ? null : canSort ? (
                    <SortHeader
                      direction={sorted}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      <table.FlexRender header={header} />
                    </SortHeader>
                  ) : (
                    <table.FlexRender header={header} />
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <TableRow key={row.id}>
            {row.getAllCells().map((cell) => (
              <TableCell key={cell.id}>
                <table.FlexRender cell={cell} />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
