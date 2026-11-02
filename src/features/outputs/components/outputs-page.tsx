"use client";

import * as React from "react";
import Link from "next/link";
import { useQueries } from "@tanstack/react-query";
import { FileOutput } from "lucide-react";

import { AsyncPlaceholder } from "@/components/ui/async-placeholder";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { filterOutputs, outputRows, outputRuns, type OutputRow } from "@/features/outputs/outputs";
import { formatBytes, formatTime } from "@/features/runs/format";
import { runKeys, useRuns } from "@/features/runs/queries";
import type { ResultFile } from "@/features/runs/types";
import { api } from "@/lib/api";

/** Presentational table of result files, grouped by run. */
export function OutputsView({ rows, loading }: { rows: OutputRow[]; loading?: boolean }) {
  const [query, setQuery] = React.useState("");
  const visible = filterOutputs(rows, query);
  const groups = new Map<string, OutputRow[]>();
  for (const row of visible) groups.set(row.runId, [...(groups.get(row.runId) ?? []), row]);

  return (
    <section className="glass flex size-full flex-col gap-4 overflow-hidden rounded-xl p-5">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="font-serif text-xl font-semibold">产物</h1>
          <p className="mt-1 text-sm text-muted-foreground">流程跑出来的结果，每个文件都记着来自哪次运行、哪个模块。过程和日志在「运行记录」里。</p>
        </div>
        <div className="w-64">
          <SearchField value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文件、模块或运行" aria-label="搜索产物" />
        </div>
      </header>
      {loading ? (
        <AsyncPlaceholder status="pending" className="flex-1" />
      ) : rows.length === 0 ? (
        <div className="grid flex-1 place-items-center text-center">
          <div className="grid max-w-sm justify-items-center gap-3">
            <FileOutput className="size-8 text-muted-foreground" aria-hidden />
            <p className="font-medium">还没有产物</p>
            <p className="text-sm text-muted-foreground">流程成功跑完后，发布到结果目录的文件会出现在这里。</p>
            <Button asChild variant="glass" size="sm"><Link href="/workflows">去流程编排</Link></Button>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>文件</TableHead>
                <TableHead className="w-40">来源模块</TableHead>
                <TableHead className="w-24 text-right">大小</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...groups.entries()].map(([runId, items]) => (
                <React.Fragment key={runId}>
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={3} className="pt-4 text-xs text-muted-foreground">
                      <Link href={`/runs/${runId}`} className="font-medium text-foreground hover:underline">{items[0].workflowName}</Link>
                      <span className="font-mono"> · {items[0].runName}</span>
                      {items[0].completedAt ? <span> · {formatTime(items[0].completedAt)}</span> : null}
                      <span> · {items.length} 个文件</span>
                    </TableCell>
                  </TableRow>
                  {items.map((row) => (
                    <TableRow key={`${runId}:${row.path}`}>
                      <TableCell className="max-w-0">
                        <Link href={`/runs/${runId}`} className="block truncate font-mono text-xs hover:underline" title={row.path}>{row.path}</Link>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{row.source || "—"}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">{formatBytes(row.size)}</TableCell>
                    </TableRow>
                  ))}
                </React.Fragment>
              ))}
              {visible.length === 0 ? (
                <TableRow><TableCell colSpan={3} className="py-6 text-sm text-muted-foreground">没有匹配「{query}」的产物</TableCell></TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

/** `/outputs`: result files of the latest succeeded runs. */
export function OutputsPage() {
  const runs = useRuns();
  const finished = outputRuns(runs.data ?? []);
  const results = useQueries({
    queries: finished.map((run) => ({
      queryKey: [...runKeys.detail(run.id), "results"],
      queryFn: () => api<ResultFile[]>(`/runs/${run.id}/results`),
    })),
  });
  if (runs.error) return <AsyncPlaceholder status="error" message={runs.error.message} />;
  const rows = finished.flatMap((run, index) => outputRows(run, results[index]?.data ?? []));
  return <OutputsView rows={rows} loading={runs.isPending || results.some((result) => result.isPending)} />;
}
