"use client";

import * as React from "react";
import { Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { backendBridge, useBackendList, useBackendManager, useWslDistros } from "@/features/desktop/backend-queries";
import type { DesktopBackendList, DesktopConnection } from "@/lib/desktop";
import { cn } from "@/lib/utils";

type Kind = DesktopConnection["kind"];
const KIND_LABEL: Record<Kind, string> = { local: "本机", wsl: "WSL", ssh: "SSH", url: "地址" };

export function connectionDetail(connection: DesktopConnection): string {
  switch (connection.kind) {
    case "local": return "这台电脑";
    case "wsl": return `WSL · ${connection.distro ?? ""}`;
    case "ssh": return `ssh ${connection.target ?? ""}${connection.port ? `:${connection.port}` : ""}`;
    case "url": return connection.url ?? "";
  }
}

export interface NewConnection {
  kind: Kind;
  distro?: string;
  target?: string;
  port?: string;
  identityFile?: string;
  url?: string;
  token?: string;
}

export interface BackendManagerViewProps {
  list: DesktopBackendList;
  distros: string[];
  /** Id of the connection being started; the window switches to the start-up screen right after. */
  pendingId?: string;
  error?: string;
  installingWsl?: boolean;
  onConnect: (connection: DesktopConnection) => void;
  onCreate: (connection: NewConnection) => void;
  onRemove: (connection: DesktopConnection) => void;
  onInstallWsl: () => void;
}

/** Saved backends (connect, remove) and a form for a new one. */
export function BackendManagerView({ list, distros, pendingId, error, installingWsl, onConnect, onCreate, onRemove, onInstallWsl }: BackendManagerViewProps) {
  const kinds = (Object.keys(KIND_LABEL) as Kind[]).filter((kind) => (kind !== "local" || list.localAvailable) && (kind !== "wsl" || list.platform === "win32"));
  const [kind, setKind] = React.useState<Kind>(kinds[0] ?? "ssh");
  const [form, setForm] = React.useState<NewConnection>({ kind });
  const set = (patch: Partial<NewConnection>) => setForm((current) => ({ ...current, ...patch }));
  const distro = form.distro ?? distros[0];
  const busy = pendingId !== undefined;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    onCreate({ ...form, kind, ...(kind === "wsl" ? { distro } : {}) });
  };

  return (
    <div className="grid gap-6">
      <section className="grid gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">已保存</h3>
        <ul className="-mx-2 grid gap-0.5">
          {list.connections.map((connection) => {
            const current = connection.id === list.currentId;
            const detail = connectionDetail(connection);
            return (
              <li key={connection.id} className="group flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-glass-strong">
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <span className="truncate">{connection.label}</span>
                    {current ? <span className="rounded-full bg-primary/12 px-2 py-px text-[11px] font-medium text-primary">当前</span> : null}
                  </span>
                  {detail !== connection.label ? <span className="truncate font-mono text-[11.5px] text-muted-foreground">{detail}</span> : null}
                </div>
                {current ? null : (
                  <>
                    <Button type="button" size="sm" variant="glass" disabled={busy} onClick={() => onConnect(connection)}>
                      {pendingId === connection.id ? <Loader2 className="animate-spin" /> : null}
                      连接
                    </Button>
                    <Button type="button" size="icon-sm" variant="ghost" disabled={busy} aria-label={`移除 ${connection.label}`} className="text-muted-foreground" onClick={() => onRemove(connection)}>
                      <X />
                    </Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="grid gap-3">
        <h3 className="text-xs font-medium text-muted-foreground">新建</h3>
        <div role="tablist" aria-label="后端类型" className="inline-flex w-fit gap-0.5 rounded-lg border border-glass-border p-0.5">
          {kinds.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={item === kind}
              onClick={() => setKind(item)}
              className={cn("h-7 rounded-md px-3.5 text-sm text-muted-foreground transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none", item === kind && "bg-primary/12 font-medium text-foreground")}
            >
              {KIND_LABEL[item]}
            </button>
          ))}
        </div>
        <form className="grid gap-3" onSubmit={submit} autoComplete="off">
          {kind === "local" ? <p className="text-sm text-muted-foreground">在这台电脑上运行应用自带的服务端。</p> : null}
          {kind === "wsl" ? (
            distros.length ? (
              <FormField label="发行版">
                <Select value={distro} onValueChange={(value) => set({ distro: value })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{distros.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent>
                </Select>
              </FormField>
            ) : (
              <div className="flex items-center gap-3 rounded-lg border border-dashed border-glass-border px-3 py-2.5 text-sm text-muted-foreground">
                <span className="flex-1">没有可用的 WSL 发行版</span>
                <Button type="button" size="sm" variant="glass" disabled={installingWsl} onClick={onInstallWsl}>
                  {installingWsl ? <Loader2 className="animate-spin" /> : null}
                  安装 WSL
                </Button>
              </div>
            )
          ) : null}
          {kind === "ssh" ? (
            <>
              <div className="grid grid-cols-[1fr_6rem] gap-3">
                <FormField label="目标" htmlFor="backend-target"><Input id="backend-target" required className="font-mono" placeholder="user@server 或 ~/.ssh/config 别名" value={form.target ?? ""} onChange={(event) => set({ target: event.target.value })} /></FormField>
                <FormField label="端口" htmlFor="backend-port"><Input id="backend-port" inputMode="numeric" className="font-mono" placeholder="22" value={form.port ?? ""} onChange={(event) => set({ port: event.target.value })} /></FormField>
              </div>
              <FormField label="私钥（可选）" htmlFor="backend-key"><Input id="backend-key" className="font-mono" placeholder="~/.ssh/id_ed25519" value={form.identityFile ?? ""} onChange={(event) => set({ identityFile: event.target.value })} /></FormField>
            </>
          ) : null}
          {kind === "url" ? (
            <>
              <FormField label="地址" htmlFor="backend-url"><Input id="backend-url" required className="font-mono" placeholder="http://127.0.0.1:8765" value={form.url ?? ""} onChange={(event) => set({ url: event.target.value })} /></FormField>
              <FormField label="令牌" htmlFor="backend-token"><Input id="backend-token" required type="password" value={form.token ?? ""} onChange={(event) => set({ token: event.target.value })} /></FormField>
            </>
          ) : null}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <div className="flex justify-end">
            <Button type="submit" disabled={busy || (kind === "wsl" && !distros.length)}>
              {pendingId === "new" ? <Loader2 className="animate-spin" /> : null}
              连接
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}

/** "切换" on the 后端环境 card, and File ▸ 后端环境… in the desktop app. */
export function BackendManagerDialog() {
  const { open, setOpen } = useBackendManager();
  const list = useBackendList(open);
  const distros = useWslDistros(open && list.data?.platform === "win32");
  const [pendingId, setPendingId] = React.useState<string>();
  const [error, setError] = React.useState<string>();
  const [installingWsl, setInstallingWsl] = React.useState(false);
  const bridge = backendBridge();

  if (!bridge) return null;
  const onOpenChange = (next: boolean) => {
    if (!next) { setPendingId(undefined); setError(undefined); }
    setOpen(next);
  };

  const start = async (id: string, connection: Parameters<typeof bridge.connect>[0], token?: string) => {
    setError(undefined);
    setPendingId(id);
    const result = await bridge.connect(connection, token);
    // On success the window moves to the start-up screen; only a refused request comes back here.
    if (!result.ok) { setPendingId(undefined); setError(result.error); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>后端环境</DialogTitle>
          <DialogDescription>服务端可以跑在 WSL、远程机器上，或者连接一个已经在运行的地址。切换时会停止当前的本机或 WSL 服务端。</DialogDescription>
        </DialogHeader>
        {list.data ? (
          <BackendManagerView
            list={list.data}
            distros={distros.data ?? []}
            pendingId={pendingId}
            error={error}
            installingWsl={installingWsl}
            onConnect={(connection) => void start(connection.id, connection)}
            onCreate={({ token, port, ...connection }) => void start("new", { ...connection, ...(port ? { port: Number(port) } : {}) }, token)}
            onRemove={async (connection) => { await bridge.remove(connection.id); await list.refetch(); }}
            onInstallWsl={async () => {
              setInstallingWsl(true);
              const result = await bridge.installWsl();
              setInstallingWsl(false);
              setError(result.ok ? undefined : result.error);
              await distros.refetch();
            }}
          />
        ) : (
          <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        )}
      </DialogContent>
    </Dialog>
  );
}
