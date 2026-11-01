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
      <div className="font-medium">源已改动：跟钉住的原版 r{pinnedRev}，还是跟最新 r{currentRev}？</div>
      <p className="mt-1 text-muted-foreground">
        {version ? `${version} ` : ""}钉住 sourceNotebookRev r{pinnedRev}；笔记本「{notebookName}」之后改到 r{currentRev}
        {changes}。打开原版是只读，打开最新不改已发布模块。
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href={`/notebooks/${notebookId}?rev=${pinnedRev}`}>打开原版 r{pinnedRev}（只读）</Link>
        </Button>
        <Button asChild size="sm">
          <Link href={`/notebooks/${notebookId}`}>打开最新 r{currentRev}</Link>
        </Button>
      </div>
    </div>
  );
}
