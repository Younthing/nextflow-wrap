"use client";

import * as React from "react";
import { CheckCircle2, Plug, Plus, Save, Server, Trash2, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { PathInput } from "@/features/files/components/path-input";
import type { RemoteHost, RemoteProbe } from "../types";

/** A new host's id: unique, stable once saved, never shown. */
function newHostId(hosts: RemoteHost[]) {
  for (let n = hosts.length + 1; ; n++) {
    const id = `cluster-${n}`;
    if (!hosts.some((host) => host.id === id)) return id;
  }
}

const blank = (hosts: RemoteHost[]): RemoteHost => ({ id: newHostId(hosts), name: `集群 ${hosts.length + 1}`, host: "", baseDir: "~/nextflow-studio" });

function ProbeResult({ probe }: { probe: RemoteProbe }) {
  if (!probe.ok) {
    return (
      <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
        <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <pre className="whitespace-pre-wrap font-sans">{probe.error}</pre>
      </div>
    );
  }
  return (
    <div role="status" className="space-y-1 rounded-md border border-success/40 bg-success/5 p-2 text-xs">
      <p className="flex items-center gap-1.5 font-medium text-success"><CheckCircle2 className="size-4" aria-hidden="true" /> 连接成功</p>
      <p className="text-muted-foreground">基础目录 <code className="font-mono">{probe.baseDir}</code></p>
      <p className="text-muted-foreground">Nextflow <code className="font-mono">{probe.nextflow}</code>{probe.java ? <> · {probe.java}</> : null}</p>
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-muted-foreground">调度器</span>
        {probe.schedulers.length ? probe.schedulers.map((name) => <Badge key={name} variant="secondary" className="font-mono">{name}</Badge>) : <span className="text-muted-foreground">没有（只能在登录节点上直接运行）</span>}
        <span className="ml-2 text-muted-foreground">运行时</span>
        {probe.runtimes.length ? probe.runtimes.map((name) => <Badge key={name} variant="outline" className="font-mono">{name}</Badge>) : <span className="text-muted-foreground">没有</span>}
      </div>
    </div>
  );
}

function HostCard({ host, probe, testing, onChange, onRemove, onTest }: {
  host: RemoteHost;
  probe?: RemoteProbe;
  testing: boolean;
  onChange: (patch: Partial<RemoteHost>) => void;
  onRemove: () => void;
  onTest: () => void;
}) {
  const field = (key: keyof RemoteHost) => `remote-${host.id}-${key}`;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base"><Server className="size-4 text-muted-foreground" aria-hidden="true" />{host.name || "未命名"}</CardTitle>
        <div className="flex items-center gap-1">
          <Button type="button" size="sm" variant="outline" disabled={!host.host || testing} onClick={onTest}><Plug />{testing ? "正在连接…" : "测试连接"}</Button>
          <Button type="button" size="sm" variant="ghost" aria-label={`删除 ${host.name}`} onClick={onRemove}><Trash2 /></Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label="名称" htmlFor={field("name")}>
            <Input id={field("name")} className="h-8 text-xs" value={host.name} onChange={(event) => onChange({ name: event.target.value })} />
          </FormField>
          <FormField label="主机" htmlFor={field("host")} hint="主机名，或 ~/.ssh/config 里的别名">
            <Input id={field("host")} className="h-8 font-mono text-xs" placeholder="login.hpc.example.org" value={host.host} onChange={(event) => onChange({ host: event.target.value.trim() })} />
          </FormField>
          <div className="grid grid-cols-[1fr_5rem] gap-2">
            <FormField label="用户名" htmlFor={field("user")}>
              <Input id={field("user")} className="h-8 font-mono text-xs" placeholder="默认" value={host.user ?? ""} onChange={(event) => onChange({ user: event.target.value.trim() || undefined })} />
            </FormField>
            <FormField label="端口" htmlFor={field("port")}>
              <Input id={field("port")} type="number" min={1} max={65535} className="h-8 font-mono text-xs" placeholder="22" value={host.port ?? ""} onChange={(event) => onChange({ port: event.target.value ? Number(event.target.value) : undefined })} />
            </FormField>
          </div>
          <FormField label="私钥文件" htmlFor={field("identityFile")} hint="留空时用 ssh-agent 和 ~/.ssh/config">
            <PathInput id={field("identityFile")} className="h-8 text-xs" value={host.identityFile ?? ""} onChange={(value) => onChange({ identityFile: value || undefined })} />
          </FormField>
          <FormField label="集群上的基础目录" htmlFor={field("baseDir")} hint="放启动目录、运行文件和默认 work 目录；要在计算节点也能访问的共享盘上">
            <Input id={field("baseDir")} className="h-8 font-mono text-xs" value={host.baseDir} onChange={(event) => onChange({ baseDir: event.target.value.trim() })} />
          </FormField>
          <FormField label="Nextflow 命令" htmlFor={field("nextflow")}>
            <Input id={field("nextflow")} className="h-8 font-mono text-xs" placeholder="nextflow" value={host.nextflow ?? ""} onChange={(event) => onChange({ nextflow: event.target.value.trim() || undefined })} />
          </FormField>
        </div>
        <FormField label="登录后先执行" htmlFor={field("setup")} hint="一行 shell 命令，在启动 Nextflow 前运行，例如加载模块或激活 conda 环境">
          <Input id={field("setup")} className="h-8 font-mono text-xs" placeholder="module load java/17 nextflow" value={host.setup ?? ""} onChange={(event) => onChange({ setup: event.target.value || undefined })} />
        </FormField>
        {probe && <ProbeResult probe={probe} />}
      </CardContent>
    </Card>
  );
}

/**
 * Cluster login nodes runs can go to. Saving replaces the whole list; a connection test uses the values as typed,
 * so a host can be checked before it is saved.
 */
export function RemoteHostsEditor({ hosts, onSave, onTest, saving }: {
  hosts: RemoteHost[];
  onSave: (hosts: RemoteHost[]) => void;
  onTest: (host: RemoteHost) => Promise<RemoteProbe>;
  saving?: boolean;
}) {
  const [draft, setDraft] = React.useState(hosts);
  const [probes, setProbes] = React.useState<Record<string, RemoteProbe>>({});
  const [testing, setTesting] = React.useState<string>();
  const dirty = JSON.stringify(draft) !== JSON.stringify(hosts);
  const update = (id: string, patch: Partial<RemoteHost>) => setDraft((current) => current.map((host) => (host.id === id ? { ...host, ...patch } : host)));
  const test = async (host: RemoteHost) => {
    setTesting(host.id);
    try {
      const probe = await onTest(host);
      setProbes((current) => ({ ...current, [host.id]: probe }));
    } catch (error) {
      setProbes((current) => ({ ...current, [host.id]: { ok: false, schedulers: [], runtimes: [], error: error instanceof Error ? error.message : String(error) } }));
    } finally {
      setTesting(undefined);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardHeader>
          <CardTitle>远程集群</CardTitle>
          <CardDescription>
            运行时选一个集群，Nextflow 就通过 SSH 在它的登录节点上启动（关掉电脑也继续跑），再由它向 SLURM 等调度器提交任务。
            需要免密登录：ssh-agent 里的密钥或下面填的私钥文件。参数里的输入文件要写集群上的路径；结果跑完后取回本机，超过 2 GB 时留在集群上。
          </CardDescription>
        </CardHeader>
      </Card>
      {draft.map((host) => (
        <HostCard
          key={host.id}
          host={host}
          probe={probes[host.id]}
          testing={testing === host.id}
          onChange={(patch) => update(host.id, patch)}
          onRemove={() => setDraft((current) => current.filter((candidate) => candidate.id !== host.id))}
          onTest={() => void test(host)}
        />
      ))}
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" onClick={() => setDraft((current) => [...current, blank(current)])}><Plus />添加集群</Button>
        <Button type="button" disabled={!dirty || saving || draft.some((host) => !host.host || !host.name)} onClick={() => onSave(draft)}><Save />保存集群设置</Button>
      </div>
    </div>
  );
}
