"use client";

import * as React from "react";
import { useTextDocument, useWriteDocument } from "@/features/workspace/document-queries";
import { Button } from "@/components/ui/button";

export function TextEditor({ path }: { path: string }) {
  const query = useTextDocument(path);
  const write = useWriteDocument(path);
  const [draft, setDraft] = React.useState<{ content: string; version: string } | null>(null);
  const [compare, setCompare] = React.useState(false);
  const save = React.useCallback(() => {
    if (!draft || write.isPending || write.isError) return;
    write.mutate(draft, { onSuccess: (saved) => setDraft((current) => current?.content === saved.content ? null : current ? { ...current, version: saved.version } : null) });
  }, [draft, write]);
  React.useEffect(() => { if (!draft) return; const timer = setTimeout(save, 1500); return () => clearTimeout(timer); }, [draft, save]);
  React.useEffect(() => {
    const handler = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key === "s") { event.preventDefault(); save(); } };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [save]);
  if (query.isPending) return <p className="p-4">正在读取…</p>;
  if (query.error && !draft) return <p role="alert" className="p-4 text-destructive">{query.error.message}</p>;
  const current = draft ?? query.data;
  return <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
    <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="truncate">{path}</span><span>{write.isPending ? "保存中…" : draft ? "未保存" : "已保存"}</span><Button size="sm" variant="ghost" onClick={save}>保存</Button></div>
    {write.error ? <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
      {write.error.message}
      <Button size="sm" variant="outline" onClick={() => { void query.refetch(); setCompare(!compare); }}>比较磁盘内容</Button>
      <Button size="sm" variant="outline" onClick={async () => { await query.refetch(); setDraft(null); write.reset(); }}>重新载入</Button>
    </div> : null}
    {compare && query.data ? <pre className="max-h-48 overflow-auto rounded border border-border p-2 text-xs">{query.data.content}</pre> : null}
    <textarea aria-label={path} spellCheck={false} className="min-h-0 flex-1 resize-none rounded bg-transparent p-2 font-mono text-sm outline-none" value={current?.content ?? ""} onChange={(event) => setDraft({ content: event.target.value, version: draft?.version ?? query.data!.version })} />
  </div>;
}
