"use client";

import * as React from "react";
import { ArrowLeftRight, Globe, Hammer, Laptop, MoreHorizontal, RotateCw, Server, Terminal, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { backendBridge, useBackendInfo, useBackendManager } from "@/features/desktop/backend-queries";
import { useHealthStatus } from "@/features/runs/queries";
import type { DesktopBackendAction, DesktopConnection } from "@/lib/desktop";
import { cn } from "@/lib/utils";

export type BackendState = "ok" | "degraded" | "checking" | "offline";

export interface BackendCardViewProps {
  /** Where the server runs; undefined in a browser, where the page only knows the server it came from. */
  kind?: DesktopConnection["kind"];
  label: string;
  detail?: string;
  state: BackendState;
  serverVersion?: string;
  build?: string;
  nextflow?: string;
  /** The desktop shell can manage this backend (restart, reinstall, clear, switch). */
  manageable: boolean;
  /** A development shell: reinstalling rebuilds from the checkout. */
  dev?: boolean;
  onRun?: (action: DesktopBackendAction) => void;
  onManage?: () => void;
}

const KIND_ICON = { local: Laptop, wsl: Terminal, ssh: Server, url: Globe } as const;
const STATE_TEXT: Record<BackendState, string> = { ok: "运行正常", degraded: "运行环境待检查", checking: "正在检查…", offline: "没有响应" };
const STATE_DOT: Record<BackendState, string> = { ok: "bg-success", degraded: "bg-warning", checking: "bg-muted-foreground/50", offline: "bg-destructive" };

/** Build ids are a timestamp and a random suffix: the date part is what people compare. */
export const shortBuild = (build: string) => (build.length > 14 ? build.slice(0, 14) : build);

type Confirm = Extract<DesktopBackendAction, "reinstall" | "clear-data">;

/** Presentational card for the welcome page: which server answers, and what can be done with it. */
export function BackendCardView({ kind, label, detail, state, serverVersion, build, nextflow, manageable, dev, onRun, onManage }: BackendCardViewProps) {
  const [confirm, setConfirm] = React.useState<Confirm>();
  const Icon = kind ? KIND_ICON[kind] : Server;
  const maintainable = manageable && kind !== "url";
  const reinstallLabel = dev ? "用当前代码重新构建" : "重新安装服务端";

  return (
    <section aria-label="后端环境" className="grid gap-3 rounded-xl border border-glass-border bg-glass p-3.5">
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-[18px]">
          <Icon aria-hidden />
        </span>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <span className="truncate text-sm font-medium" title={detail && detail !== label ? detail : undefined}>{label}</span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", STATE_DOT[state])} />
            {STATE_TEXT[state]}
          </span>
        </div>
        {maintainable ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="icon-sm" variant="ghost" aria-label="更多后端操作" className="-mr-1 text-muted-foreground">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onSelect={() => setConfirm("reinstall")}>
                <Hammer />
                {reinstallLabel}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirm("clear-data")}>
                <Trash2 />
                清除数据…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 font-mono text-[11.5px] leading-5">
        <dt className="text-muted-foreground">服务端</dt>
        <dd className="truncate" title={build}>{serverVersion ?? "—"}{build ? <span className="text-muted-foreground"> · {shortBuild(build)}</span> : null}</dd>
        <dt className="text-muted-foreground">Nextflow</dt>
        <dd className="truncate">{nextflow ?? "—"}</dd>
      </dl>

      {manageable ? (
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" size="sm" variant="glass" disabled={!maintainable} onClick={() => onRun?.("restart")} title={maintainable ? undefined : "地址连接的服务端由别人运行，不能从这里重启"}>
            <RotateCw />
            重启
          </Button>
          <Button type="button" size="sm" variant="glass" onClick={onManage}>
            <ArrowLeftRight />
            切换
          </Button>
        </div>
      ) : null}

      <Dialog open={confirm !== undefined} onOpenChange={(open) => { if (!open) setConfirm(undefined); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{confirm === "clear-data" ? "清除这个后端的数据？" : `${reinstallLabel}？`}</DialogTitle>
            <DialogDescription>
              {confirm === "clear-data"
                ? "会停止服务端，删除数据库、示例项目、运行记录和工作目录（work/），然后重新启动。设置、工具链，以及放在自己文件夹里的项目都会保留。"
                : dev
                  ? "会停止服务端，用这份代码重新构建服务端包（和 pnpm dev:win 一样），装好后重新启动。第一次构建需要几分钟。"
                  : "会停止服务端，用应用自带的服务端包覆盖安装，然后重新启动。数据不受影响。"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirm(undefined)}>取消</Button>
            <Button
              type="button"
              variant={confirm === "clear-data" ? "destructive" : "default"}
              onClick={() => { if (confirm) onRun?.(confirm); setConfirm(undefined); }}
            >
              {confirm === "clear-data" ? "清除并重启" : dev ? "重新构建" : "重新安装"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** The welcome page's 后端环境 card: the shell's backend in the desktop app, the answering server in a browser. */
export function BackendCard() {
  const info = useBackendInfo();
  const health = useHealthStatus();
  const openManager = useBackendManager((state) => state.setOpen);
  const bridge = backendBridge();
  const data = info.data;
  const state: BackendState = health.isError ? "offline" : !health.data ? "checking" : health.data.status === "ok" ? "ok" : "degraded";

  return (
    <BackendCardView
      kind={data?.connection.kind}
      label={data?.connection.label ?? (health.data?.mocked ? "演示数据（浏览器）" : "当前服务端")}
      detail={data?.detail}
      state={state}
      serverVersion={health.data?.appVersion ?? data?.server.version}
      build={health.data?.build ?? data?.server.build}
      nextflow={health.data ? health.data.nextflowVersion : undefined}
      manageable={Boolean(bridge && data)}
      dev={data?.dev}
      onRun={(action) => void bridge?.run(action)}
      onManage={() => openManager(true)}
    />
  );
}
