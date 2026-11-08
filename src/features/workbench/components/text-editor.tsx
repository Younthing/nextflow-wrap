"use client";

import * as React from "react";
import { useStore } from "zustand";
import { useRouter } from "next/navigation";
import { useCreateTextDocument, useTextDocument } from "@/features/workspace/document-queries";
import { Button } from "@/components/ui/button";
import { saveTextDocument, textSession } from "../document-sessions";
import { NameDialog } from "./workbench-file-dialogs";

export function TextEditor({ path }: { path: string }) {
  const query = useTextDocument(path);
  const create = useCreateTextDocument();
  const router = useRouter();
  const [savingAs, setSavingAs] = React.useState(false);
  const [session] = React.useState(() => textSession(path));
  const state = useStore(session);
  const [compare, setCompare] = React.useState(false);
  React.useEffect(() => {
    if (!query.data) return;
    const current = session.getState();
    if (current.draft !== undefined && current.saved?.version !== query.data.version) {
      if (!current.saving) session.setState({ error: "文件在外部被修改，本地编辑已保留" });
    } else session.setState({ saved: query.data });
  }, [query.data, session]);
  React.useEffect(() => {
    if (state.draft === undefined || state.error || state.saving || state.paused) return;
    const timer = setTimeout(() => { void saveTextDocument(path).catch(() => {}); }, 1500);
    return () => clearTimeout(timer);
  }, [state.draft, state.error, state.saving, state.paused, path]);
  React.useEffect(() => {
    const handler = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key === "s") { event.preventDefault(); void saveTextDocument(path).catch(() => {}); } };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [path]);
  if (query.isPending && !state.saved) return <p className="p-4">正在读取…</p>;
  if (query.error && state.draft === undefined) return <p role="alert" className="p-4 text-destructive">{query.error.message}</p>;
  return <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
    <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="truncate">{path}</span><span>{state.saving ? "保存中…" : state.draft !== undefined ? "未保存" : "已保存"}</span><Button size="sm" variant="ghost" onClick={() => void saveTextDocument(path).catch(() => {})}>保存</Button></div>
    {state.error ? <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
      {state.error}
      <Button size="sm" variant="outline" onClick={() => { void query.refetch(); setCompare(!compare); }}>比较磁盘内容</Button>
      <Button size="sm" variant="outline" onClick={async () => { const result = await query.refetch(); if (result.data) session.setState({ saved: result.data, draft: undefined, error: undefined }); }}>重新载入</Button>
      <Button size="sm" variant="outline" onClick={() => setSavingAs(true)}>另存为副本</Button>
      <Button size="sm" variant="destructive" onClick={async () => { const result = await query.refetch(); if (result.data) await saveTextDocument(path, result.data.version).catch(() => {}); }}>用本地内容覆盖</Button>
    </div> : null}
    {compare && query.data ? <pre className="max-h-48 overflow-auto rounded border border-border p-2 text-xs">{query.data.content}</pre> : null}
    <textarea aria-label={path} spellCheck={false} className="min-h-0 flex-1 resize-none rounded bg-transparent p-2 font-mono text-sm outline-none" value={state.draft ?? state.saved?.content ?? ""} onChange={(event) => session.setState({ draft: event.target.value })} />
    <NameDialog open={savingAs} title="另存为副本" initial={`${path}.copy`} maxLength={4000} pending={create.isPending} submitLabel="保存" onClose={() => setSavingAs(false)} onSubmit={(target) => create.mutate({ path: target, content: state.draft ?? state.saved?.content ?? "" }, { onSuccess: () => { session.setState({ draft: undefined, error: undefined }); setSavingAs(false); router.push(`/workbench/file/${encodeURIComponent(target)}`); } })} />
  </div>;
}
