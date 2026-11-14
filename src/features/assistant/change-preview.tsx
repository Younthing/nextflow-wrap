const PREVIEW_LIMIT = 8_000;

export function ChangePreview({ before, after }: { before?: string; after?: string }) {
  let first = 0;
  let oldLines = before?.split("\n") ?? [];
  let newLines = after?.split("\n") ?? [];
  if (before !== after) {
    while (first < oldLines.length && first < newLines.length && oldLines[first] === newLines[first]) first++;
    let oldEnd = oldLines.length;
    let newEnd = newLines.length;
    while (oldEnd > first && newEnd > first && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
      oldEnd--;
      newEnd--;
    }
    oldLines = oldLines.slice(first, oldEnd);
    newLines = newLines.slice(first, newEnd);
  }
  const sections = [
    { label: "修改前", lines: oldLines, tone: "border-destructive/30" },
    { label: "修改后", lines: newLines, tone: "border-success/40" },
  ].filter(({ lines }) => lines.length > 0);
  return (
    <div className="mt-3 grid max-h-[45vh] gap-2 overflow-auto text-xs">
      {sections.map(({ label, lines, tone }) => {
        const code = lines.join("\n");
        return (
          <div key={label} className={`min-w-0 rounded-md border ${tone}`}>
            <p className="border-b border-border px-2 py-1 text-muted-foreground">{label} · 第 {first + 1} 行起</p>
            <pre className="overflow-x-auto p-2 font-mono">{code.slice(0, PREVIEW_LIMIT) || "（空白）"}{code.length > PREVIEW_LIMIT ? "\n…（预览已截断）" : ""}</pre>
          </div>
        );
      })}
    </div>
  );
}
