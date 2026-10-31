"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, FolderOpen, Loader2, Pencil, Plus, Trash2, Workflow } from "lucide-react";

import { AsyncPlaceholder } from "@/components/ui/async-placeholder";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SearchField } from "@/components/ui/search-field";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/features/runs/components/run-status";
import { formatTime } from "@/features/runs/format";
import { useRuns } from "@/features/runs/queries";
import type { RunSummary } from "@/features/runs/types";
import { emptyWorkflow } from "@/features/workflow/document";
import { filterWorkflows, latestRunByWorkflow } from "@/features/workflow/library";
import { useDeleteWorkflow, useDuplicateWorkflow, useRenameWorkflow, useSaveWorkflow, useWorkflows } from "@/features/workflow/queries";
import type { WorkflowSummary } from "@/features/workflow/types";

export function WorkflowLibrary() {
  const router = useRouter();
  const workflows = useWorkflows();
  const runs = useRuns();
  const create = useSaveWorkflow();
  const duplicate = useDuplicateWorkflow();
  const remove = useDeleteWorkflow();
  const [query, setQuery] = React.useState("");
  const [renameTarget, setRenameTarget] = React.useState<WorkflowSummary | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const rows = React.useMemo(
    () => filterWorkflows(workflows.data ?? [], query),
    [workflows.data, query],
  );
  const latest = React.useMemo(() => latestRunByWorkflow(runs.data ?? []), [runs.data]);
  const rowBusy = remove.isPending || duplicate.isPending;

  const onCreate = () => {
    setActionError(null);
    create.mutate(emptyWorkflow(""), {
      onSuccess: (doc) => router.push(`/workflows/${doc.id}`),
      onError: (err) => setActionError(err.message),
    });
  };

  return (
    <section className="glass flex size-full flex-col gap-4 overflow-hidden rounded-xl p-5">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="font-serif text-xl font-semibold">流程</h1>
        <div className="min-w-48 flex-1">
          <SearchField
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索流程"
            aria-label="搜索流程"
            autoComplete="off"
          />
        </div>
        <Button type="button" onClick={onCreate} disabled={create.isPending}>
          {create.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
          新建
        </Button>
      </header>

      {(actionError || create.error) && (
        <p role="alert" className="text-sm text-destructive">
          {actionError || create.error?.message}
        </p>
      )}
      {runs.error && (
        <p className="text-xs text-muted-foreground">最近运行暂时加载失败：{runs.error.message}</p>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {workflows.isPending ? (
          <AsyncPlaceholder status="pending" className="h-40" />
        ) : workflows.error ? (
          <AsyncPlaceholder
            status="error"
            className="h-auto"
            message={`加载流程失败：${workflows.error.message}`}
          />
        ) : workflows.data?.length === 0 ? (
          <AsyncPlaceholder status="empty" className="h-60" icon={<Workflow />} description="还没有流程">
            <Button type="button" variant="outline" size="sm" onClick={onCreate} disabled={create.isPending}>
              <Plus /> 新建空白流程
            </Button>
          </AsyncPlaceholder>
        ) : rows.length === 0 ? (
          <AsyncPlaceholder status="empty" className="h-40" description="没有匹配的流程" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>更新时间</TableHead>
                <TableHead>最近运行</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">操作</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((workflow) => (
                <TableRow key={workflow.id}>
                  <TableCell className="max-w-72">
                    <Link href={`/workflows/${workflow.id}`} className="block truncate font-medium text-primary hover:underline">
                      {workflow.name}
                    </Link>
                    {workflow.description && (
                      <div className="truncate text-xs text-muted-foreground">{workflow.description}</div>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatTime(workflow.updatedAt)}
                  </TableCell>
                  <TableCell>
                    <LastRun pending={runs.isPending} run={latest.get(workflow.id)} />
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/workflows/${workflow.id}`}>
                          <FolderOpen /> 打开
                        </Link>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={rowBusy}
                        onClick={() => {
                          setActionError(null);
                          setRenameTarget(workflow);
                        }}
                      >
                        <Pencil /> 重命名
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={rowBusy}
                        onClick={() => {
                          setActionError(null);
                          duplicate.mutate(workflow.id, { onError: (err) => setActionError(err.message) });
                        }}
                      >
                        {duplicate.isPending && duplicate.variables === workflow.id ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <Copy />
                        )}
                        复制
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        disabled={rowBusy}
                        onClick={() => {
                          if (!window.confirm(`删除流程「${workflow.name}」？删除后无法恢复。`)) return;
                          setActionError(null);
                          remove.mutate(workflow.id, { onError: (err) => setActionError(err.message) });
                        }}
                      >
                        {remove.isPending && remove.variables === workflow.id ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <Trash2 />
                        )}
                        删除
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {renameTarget && (
        <RenameWorkflowDialog
          key={renameTarget.id}
          workflow={renameTarget}
          onClose={() => setRenameTarget(null)}
        />
      )}
    </section>
  );
}

function LastRun({ pending, run }: { pending: boolean; run: RunSummary | undefined }) {
  if (pending) return <span className="text-muted-foreground">…</span>;
  if (!run) return <span className="text-muted-foreground">—</span>;
  return (
    <Link href={`/runs/${run.id}`} className="inline-flex items-center gap-2 hover:underline">
      <StatusBadge status={run.status} />
      <span className="font-mono text-xs">{run.runName}</span>
    </Link>
  );
}

function RenameWorkflowDialog({ workflow, onClose }: { workflow: WorkflowSummary; onClose: () => void }) {
  const rename = useRenameWorkflow();
  const [name, setName] = React.useState(workflow.name);

  return (
    <Dialog open onOpenChange={(open) => !open && !rename.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>重命名流程</DialogTitle>
          <DialogDescription>只改显示名称，画布内容保持不变。</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const next = name.trim();
            if (!next || next === workflow.name) {
              onClose();
              return;
            }
            rename.mutate(
              { id: workflow.id, name: next },
              { onSuccess: onClose },
            );
          }}
        >
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label="流程名称"
            autoFocus
            maxLength={200}
          />
          {rename.isError && (
            <p role="alert" className="text-sm text-destructive">{rename.error.message}</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={rename.isPending}>
              取消
            </Button>
            <Button type="submit" disabled={rename.isPending || name.trim().length === 0}>
              {rename.isPending && <Loader2 className="animate-spin" />}
              保存
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
