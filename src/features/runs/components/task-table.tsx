"use client";

import * as React from "react";
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_text,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { X } from "lucide-react";

import { AsyncPlaceholder } from "@/components/ui/async-placeholder";
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
import { CodeViewer } from "@/features/project/components/code-viewer";
import { cn } from "@/lib/utils";
import { formatBytes, formatDuration, TASK_STATUS } from "../format";
import { useTaskLog } from "../queries";
import type { TaskRecord } from "../types";

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text },
});
const helper = createColumnHelper<typeof features, TaskRecord>();

// Task order as Nextflow would list them: by submission, unsubmitted last.
const submitOrder = (t: TaskRecord) => (t.submittedAt ? Date.parse(t.submittedAt) : Number.MAX_SAFE_INTEGER);

const columns = helper.columns([
  helper.accessor("status", {
    header: "状态",
    sortFn: "text",
    cell: (info) => {
      const s = TASK_STATUS[info.getValue()];
      return (
        <span className="flex items-center gap-1.5 text-xs">
          <span
            className={cn("size-2 rounded-full", info.getValue() === "running" && "animate-pulse")}
            style={{ background: s.color }}
          />
          {s.label}
        </span>
      );
    },
  }),
  helper.accessor("name", {
    header: "任务",
    sortFn: "alphanumeric",
    cell: (info) => <span className="font-mono text-xs">{info.getValue()}</span>,
  }),
  helper.accessor("hash", {
    header: "哈希",
    sortFn: "text",
    cell: (info) => <span className="font-mono text-xs text-muted-foreground">{info.getValue()}</span>,
  }),
  helper.accessor(submitOrder, {
    id: "submitted",
    header: "提交",
    cell: (info) => (
      <span className="font-mono text-xs text-muted-foreground">
        {info.row.original.submittedAt ? new Date(info.row.original.submittedAt).toLocaleTimeString("zh-CN", { hour12: false }) : "—"}
      </span>
    ),
  }),
  helper.accessor((t) => t.durationMs ?? -1, {
    id: "duration",
    header: "耗时",
    cell: (info) => <span className="font-mono text-xs">{formatDuration(info.row.original.durationMs)}</span>,
  }),
  helper.accessor("cpus", {
    header: "CPU",
    cell: (info) => <span className="font-mono text-xs">{info.getValue()}</span>,
  }),
  helper.accessor((t) => t.cpuPercent ?? -1, {
    id: "cpuPercent",
    header: "%CPU",
    cell: (info) => {
      const v = info.row.original.cpuPercent;
      return <span className="font-mono text-xs">{v === undefined ? "—" : `${v}%`}</span>;
    },
  }),
  helper.accessor((t) => t.peakRss ?? -1, {
    id: "peakRss",
    header: "峰值内存",
    cell: (info) => <span className="font-mono text-xs">{formatBytes(info.row.original.peakRss)}</span>,
  }),
  helper.accessor((t) => t.exitStatus ?? -1, {
    id: "exit",
    header: "退出码",
    cell: (info) => {
      const v = info.row.original.exitStatus;
      return <span className={cn("font-mono text-xs", v ? "text-destructive" : "text-muted-foreground")}>{v ?? "—"}</span>;
    },
  }),
]);

function TaskLogPanel({ runId, task, active, onClose }: { runId: string; task: TaskRecord; active: boolean; onClose: () => void }) {
  const log = useTaskLog(runId, task.id ?? task.hash, active);
  return (
    <aside className="flex w-[380px] shrink-0 flex-col gap-3 rounded-lg bg-secondary/40 p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-sm font-semibold">{task.name}</div>
          <div className="font-mono text-[11px] break-all text-muted-foreground">{task.workdir}</div>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="关闭任务详情" onClick={onClose}>
          <X />
        </Button>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-xs">
        {[
          ["状态", TASK_STATUS[task.status].label],
          ["耗时", formatDuration(task.durationMs)],
          ["峰值内存", formatBytes(task.peakRss)],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="text-[11px] text-muted-foreground">{k}</dt>
            <dd className="font-mono">{v}</dd>
          </div>
        ))}
      </dl>
      <span className="text-xs font-semibold text-muted-foreground">.command.log</span>
      <CodeViewer
        code={log.data?.text || (log.isPending ? "加载中…" : "任务还没有开始")}
        language="text"
        lineNumbers={false}
        className="min-h-0 flex-1"
      />
    </aside>
  );
}

export function TaskTable({
  runId,
  tasks,
  active,
  nodeFilter,
  nodeLabel,
  onClearFilter,
}: {
  runId: string;
  tasks: TaskRecord[];
  active: boolean;
  nodeFilter?: string | null;
  nodeLabel?: string;
  onClearFilter?: () => void;
}) {
  const [selected, setSelected] = React.useState<string | null>(null);
  const data = React.useMemo(() => (nodeFilter ? tasks.filter((t) => t.nodeId === nodeFilter) : tasks), [tasks, nodeFilter]);
  const table = useTable({
    features,
    columns,
    data,
    initialState: { sorting: [{ id: "submitted", desc: false }] },
    getRowId: (t) => t.id ?? t.hash,
  });
  const selectedTask = tasks.find((t) => (t.id ?? t.hash) === selected);

  return (
    <div className="flex min-h-0 flex-1 gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {nodeFilter && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            只看节点 <span className="font-mono text-foreground">{nodeLabel}</span> 的任务
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onClearFilter}>
              显示全部
            </Button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-background/80 backdrop-blur">
              {table.getHeaderGroups().map((group) => (
                <TableRow key={group.id}>
                  {group.headers.map((header) => {
                    const sorted = header.column.getIsSorted();
                    return (
                      <TableHead
                        key={header.id}
                        className="px-2.5 whitespace-nowrap"
                        aria-sort={
                          sorted === "asc"
                            ? "ascending"
                            : sorted === "desc"
                              ? "descending"
                              : "none"
                        }
                      >
                        <SortHeader
                          direction={sorted}
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          <table.FlexRender header={header} />
                        </SortHeader>
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  onClick={() => setSelected(row.id === selected ? null : row.id)}
                  className={cn(
                    "cursor-pointer last:border-b!",
                    row.id === selected && "bg-accent",
                  )}
                >
                  {row.getAllCells().map((cell) => (
                    <TableCell key={cell.id} className="px-2.5 py-1.5 whitespace-nowrap">
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {data.length === 0 && (
            <AsyncPlaceholder status="empty" className="h-auto" description="还没有任务" />
          )}
        </div>
      </div>
      {selectedTask && <TaskLogPanel runId={runId} task={selectedTask} active={active} onClose={() => setSelected(null)} />}
    </div>
  );
}
