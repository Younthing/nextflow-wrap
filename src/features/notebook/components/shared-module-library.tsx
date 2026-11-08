"use client";

import { Button } from "@/components/ui/button";
import type { ModuleDef } from "@/features/workflow/types";
import { useSharedModules, useTransferModule } from "../shared-queries";

export function SharedModuleLibrary({ local }: { local: ModuleDef[] }) {
  const shared = useSharedModules();
  const share = useTransferModule("share");
  const install = useTransferModule("install");
  return <details className="rounded-lg border border-border px-3 py-2 text-sm">
    <summary className="cursor-pointer font-medium">共享模块库 · {shared.data?.length ?? 0}</summary>
    <p className="mt-2 text-xs text-muted-foreground">安装会将确定版本和来源副本保存到当前项目中。</p>
    <ul className="mt-2 grid max-h-52 gap-1 overflow-auto">
      {(shared.data ?? []).map((module) => <li className="flex items-center gap-2" key={module.id}><span className="min-w-0 flex-1 truncate">{module.name} · {module.version}</span><Button size="sm" variant="outline" disabled={install.isPending || local.some((item) => item.id === module.id)} onClick={() => install.mutate(module.id)}>{local.some((item) => item.id === module.id) ? "已安装" : "安装到项目"}</Button></li>)}
      {local.filter((module) => !(shared.data ?? []).some((item) => item.id === module.id)).map((module) => <li className="flex items-center gap-2" key={module.id}><span className="min-w-0 flex-1 truncate">{module.name} · {module.version}</span><Button size="sm" variant="ghost" disabled={share.isPending} onClick={() => share.mutate(module.id)}>保存到共享库</Button></li>)}
    </ul>
    {shared.error || share.error || install.error ? <p role="alert" className="mt-2 text-xs text-destructive">{(shared.error ?? share.error ?? install.error)?.message}</p> : null}
  </details>;
}
