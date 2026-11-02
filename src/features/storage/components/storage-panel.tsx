"use client";

import * as React from "react";
import Link from "next/link";
import { HardDrive, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { PanelLoading, PanelNotice } from "@/components/ui/panel-notice";
import { Switch } from "@/components/ui/switch";
import { formatBytes, formatTime } from "@/features/runs/format";
import { toast } from "@/lib/toast";
import { useCleanSession, useStorageReport } from "../queries";
import type { SessionUsage, StorageReport } from "../types";

function CleanDialog({ session, onClose, onConfirm, pending }: { session: SessionUsage; onClose: () => void; onConfirm: (results: boolean) => void; pending?: boolean }) {
  const [results, setResults] = React.useState(false);
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>清理「{session.workflowName}」这次会话的 work 目录？</DialogTitle>
          <DialogDescription>
            可释放约 {formatBytes(session.reclaimableBytes)}。已发布的结果是硬链接，不受影响。清理后下面这些运行都不能再续跑（-resume），只能重新运行：
          </DialogDescription>
        </DialogHeader>
        <ul className="grid gap-1 font-mono text-xs">
          {session.runs.map((run) => <li key={run.id}>{run.runName} · {formatTime(run.submittedAt)}</li>)}
        </ul>
        <div className="flex items-center gap-2">
          <Switch id="clean-results" checked={results} onCheckedChange={setResults} />
          <Label htmlFor="clean-results" className="text-sm">同时删除这些运行的结果（{formatBytes(session.resultBytes)}）</Label>
        </div>
        <DialogFooter>
          <Button variant="glass" onClick={onClose}>取消</Button>
          <Button variant="destructive" disabled={pending} onClick={() => onConfirm(results)}><Trash2 />清理</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function StorageView({ report, onClean, cleaning }: { report: StorageReport; onClean: (session: SessionUsage, results: boolean) => void; cleaning?: string }) {
  const [target, setTarget] = React.useState<SessionUsage>();
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><HardDrive className="size-4" />磁盘占用</CardTitle>
          <CardDescription>所有流程共用一个 work 目录，所以按 Nextflow 会话清理：一次运行和从它恢复的运行属于同一个会话，共用缓存的任务目录。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-4">
          {report.caches.map((cache) => (
            <div key={cache.id} className="glass rounded-lg p-3" title={cache.path}>
              <div className="text-xs text-muted-foreground">{cache.label}</div>
              <div className="font-mono text-lg">{formatBytes(cache.bytes)}</div>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>按会话</CardTitle>
          {report.truncated && <CardDescription>文件太多，部分大小是估计值。</CardDescription>}
        </CardHeader>
        <CardContent>
          {report.sessions.length === 0 && <p className="text-sm text-muted-foreground">还没有运行记录。</p>}
          <ul className="flex flex-col divide-y divide-border/60">
            {report.sessions.map((session) => (
              <li key={session.key} className="flex flex-wrap items-center gap-3 py-3" aria-label={`${session.workflowName} 会话`}>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/workflows/${session.workflowId}`} className="font-medium hover:underline">{session.workflowName}</Link>
                    {session.active && <Badge variant="warning">运行中</Badge>}
                    {session.cleanedAt && <Badge variant="secondary">work 已清理 · 不能续跑</Badge>}
                    {session.remote && <Badge variant="outline">对象存储：请用 nextflow clean</Badge>}
                  </div>
                  <div className="flex flex-wrap gap-x-2 font-mono text-xs text-muted-foreground">
                    {session.runs.map((run) => <Link key={run.id} href={`/runs/${run.id}`} className="hover:underline">{run.runName}</Link>)}
                  </div>
                </div>
                <dl className="grid grid-cols-3 gap-4 text-right text-xs">
                  <div><dt className="text-muted-foreground">work</dt><dd className="font-mono">{formatBytes(session.workBytes)}</dd></div>
                  <div><dt className="text-muted-foreground">可释放</dt><dd className="font-mono">{formatBytes(session.reclaimableBytes)}</dd></div>
                  <div><dt className="text-muted-foreground">结果</dt><dd className="font-mono">{formatBytes(session.resultBytes)}</dd></div>
                </dl>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={session.active || (session.workDirs === 0 && session.resultBytes === 0) || cleaning === session.key}
                  onClick={() => setTarget(session)}
                >
                  <Trash2 />清理
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      {target && (
        <CleanDialog
          session={target}
          pending={cleaning === target.key}
          onClose={() => setTarget(undefined)}
          onConfirm={(results) => { onClean(target, results); setTarget(undefined); }}
        />
      )}
    </div>
  );
}

export function StoragePanel() {
  const report = useStorageReport();
  const clean = useCleanSession();
  if (report.isPending) return <PanelLoading message="正在统计磁盘占用…" className="h-40" />;
  if (report.isError) return <PanelNotice tone="danger" message={report.error.message} className="h-40" />;
  return (
    <StorageView
      report={report.data}
      cleaning={clean.isPending ? clean.variables?.key : undefined}
      onClean={(session, results) => clean.mutate({ key: session.key, results }, {
        onSuccess: (result) => toast.success(`已清理 ${result.removedDirs} 个任务目录，释放 ${formatBytes(result.freedBytes)}`),
        onError: (error) => toast.error(error.message),
      })}
    />
  );
}
