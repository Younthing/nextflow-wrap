import { Server } from "lucide-react";

import { formatBytes } from "@/features/runs/format";
import type { RemoteRunState } from "../types";

/** Where a cluster run's results are: coming back after the run, back here, or left on the cluster. */
export function RemoteResultsNotice({ host, remote, active }: { host: string; remote?: RemoteRunState; active: boolean }) {
  const message = remote?.resultsLeftRemote
    ? <>结果共 {formatBytes(remote.resultsBytes)}，超过取回上限，留在 {host} 的 <code className="font-mono break-all">{remote.outdir}</code></>
    : active
      ? <>这次运行在 {host} 上，结果在运行结束后取回本机{remote ? <>；集群上的位置 <code className="font-mono break-all">{remote.outdir}</code></> : null}</>
      : <>结果已从 {host} 取回本机{remote ? <>，集群上仍保留 <code className="font-mono break-all">{remote.outdir}</code></> : null}</>;
  return (
    <p role="status" className="flex items-start gap-2 rounded-md bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
      <Server className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </p>
  );
}
