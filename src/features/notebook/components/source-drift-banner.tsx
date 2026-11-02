import Link from "next/link";

import { Button } from "@/components/ui/button";

export function SourceDriftBanner({
  notebookId,
  notebookName,
  pinnedRev,
  currentRev,
  cellChanges,
  version,
}: {
  notebookId: string;
  notebookName: string;
  pinnedRev: number;
  currentRev: number;
  cellChanges: number;
  version?: string;
}) {
  if (!notebookId || currentRev === pinnedRev) return null;
  const changes = cellChanges > 0 ? `（${cellChanges} 处单元格变动）` : "";
  return (
    <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
      <div className="font-medium">源笔记本已更新</div>
      <p className="mt-1 text-muted-foreground">
        {version ? `${version} · ` : ""}「{notebookName}」r{pinnedRev} → r{currentRev}{changes}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href={`/workbench/${notebookId}?rev=${pinnedRev}`}>打开原版 r{pinnedRev}（只读）</Link>
        </Button>
        <Button asChild size="sm">
          <Link href={`/workbench/${notebookId}`}>打开最新 r{currentRev}</Link>
        </Button>
      </div>
    </div>
  );
}
