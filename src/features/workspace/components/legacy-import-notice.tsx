"use client";

import { History, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";
import { useImportLegacy, useLegacySummary } from "../queries";

/**
 * Shown on the workbench start page while the data directory still holds the database of an app version from
 * before project folders: its workflows and published modules can be copied into the open project once.
 */
export function LegacyImportNotice({ projectId }: { projectId: string }) {
  const summary = useLegacySummary(projectId);
  const run = useImportLegacy(projectId);
  if (!summary.data) return null;
  const { workflows, modules } = summary.data;
  return (
    <section aria-labelledby="legacy-import" className="flex flex-wrap items-center gap-3 rounded-xl border border-glass-border bg-glass px-4 py-3">
      <History className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="grid min-w-0 flex-1 gap-0.5">
        <h2 id="legacy-import" className="text-sm font-medium">旧版本的流程和模块</h2>
        <p className="text-xs text-muted-foreground">
          升级前保存的 {workflows} 个流程、{modules} 个已发布模块还在应用数据里。导入后流程放在 workflows/旧版导入/，模块放进 modules/；原数据保留，可以再导入到别的项目。
        </p>
      </div>
      <Button
        size="sm"
        variant="outline"
        disabled={run.isPending}
        onClick={() => run.mutate(undefined, {
          onSuccess: (result) => {
            const done = `已导入 ${result.workflows} 个流程、${result.modules} 个模块`;
            if (result.skipped.length) toast.warning(`${done}；跳过：${result.skipped.join("、")}`);
            else toast.success(done);
          },
          onError: (error) => toast.error(error.message),
        })}
      >
        {run.isPending ? <Loader2 className="animate-spin" /> : null}
        导入到当前项目
      </Button>
    </section>
  );
}
