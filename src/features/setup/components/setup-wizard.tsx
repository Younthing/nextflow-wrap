"use client";

import Link from "next/link";
import * as React from "react";
import { ArrowRight, FlaskConical, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PanelLoading, PanelNotice } from "@/components/ui/panel-notice";
import { mockingActive, setDemoMode } from "@/lib/mocking";
import { getProductTheme } from "@/lib/product-theme";
import { toast } from "@/lib/toast";
import { shouldAutoInstall } from "../auto-install";
import { useInstallRequired, useInstallTool, useSetupStatus } from "../queries";
import type { SetupStatus, ToolStatus } from "../types";
import { ToolChecklist } from "./tool-checklist";

/** Presentational part of the first-run wizard, used by the page and by stories. */
export function SetupWizardView({
  status,
  onInstall,
  installing,
  onRefresh,
  refreshing,
  demo,
  onDemo,
}: {
  status: SetupStatus;
  onInstall: (tool: ToolStatus) => void;
  installing?: string;
  onRefresh: () => void;
  refreshing?: boolean;
  demo: boolean;
  onDemo: (on: boolean) => void;
}) {
  const kernels = status.condaEnvironments.filter((env) => env.hasKernel);
  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-4 overflow-y-auto pb-6">
      <Card>
        <CardHeader>
          <CardTitle className="font-serif text-xl">欢迎使用 {getProductTheme().displayName}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ToolChecklist tools={status.tools} onInstall={onInstall} installing={installing} />
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>数据目录</span>
            <code className="font-mono">{status.dataDirectory}</code>
            <span>·</span>
            <span>{status.platform}</span>
          </div>
        </CardContent>
      </Card>

      {status.condaEnvironments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>已有的 conda 环境</CardTitle>
            <CardDescription>
              注册为内核：<code className="ml-1 font-mono">python -m ipykernel install --user --name 环境名</code>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-1 text-sm">
              {status.condaEnvironments.map((env) => (
                <li key={env.prefix} className="flex items-center gap-2">
                  <span className="font-medium">{env.name}</span>
                  <span className="truncate font-mono text-xs text-muted-foreground">{env.prefix}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{env.hasKernel ? "可作内核" : "未注册内核"}</span>
                </li>
              ))}
            </ul>
            {kernels.length === 0 && <p className="mt-2 text-xs text-muted-foreground">还没有可用作内核的 conda 环境。</p>}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="glass" onClick={onRefresh} disabled={refreshing}>
          <RefreshCw className={refreshing ? "animate-spin" : undefined} />
          重新检查
        </Button>
        {demo ? (
          <Button variant="glass" onClick={() => onDemo(false)}>退出演示模式</Button>
        ) : (
          <Button variant="glass" onClick={() => onDemo(true)}>
            <FlaskConical />
            先进演示模式
          </Button>
        )}
        <Button asChild className="ml-auto" disabled={!status.ready}>
          <Link href="/" aria-disabled={!status.ready}>
            {status.ready ? "开始使用" : "必需的工具就绪后可以开始"}
            <ArrowRight />
          </Link>
        </Button>
      </div>
    </div>
  );
}

export function SetupWizard() {
  const status = useSetupStatus();
  const install = useInstallTool();
  const installRequired = useInstallRequired();
  const started = React.useRef(false);
  // A fresh machine (or WSL distro, or server) installs Java and Nextflow on its own. Once per visit: after a
  // failure the buttons take over.
  React.useEffect(() => {
    if (started.current || !status.data || mockingActive() || !shouldAutoInstall(status.data)) return;
    started.current = true;
    installRequired.mutate(undefined, { onError: (error) => toast.error(error.message) });
  }, [status.data, installRequired]);
  if (status.isPending) return <PanelLoading message="正在检查运行环境…" />;
  if (status.isError) return <PanelNotice tone="danger" message={`检查失败：${status.error.message}`} />;
  return (
    <SetupWizardView
      status={status.data}
      installing={install.isPending ? install.variables : undefined}
      onInstall={(tool) => install.mutate(tool.id, {
        onSuccess: (result) => { if (!result.started && result.message) toast.error(result.message); },
        onError: (error) => toast.error(error.message),
      })}
      onRefresh={() => void status.refetch()}
      refreshing={status.isFetching}
      demo={mockingActive()}
      onDemo={setDemoMode}
    />
  );
}
