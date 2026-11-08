"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useNotebookSession, useNotebookSessionState } from "@/features/notebook/session-provider";
import { useCreateNotebook, useNotebook, useSaveNotebook } from "@/features/notebook/queries";
import { useEditorStore, useEditorStoreApi } from "@/features/editor/editor-provider";
import { useSaveWorkflow, useWorkflow } from "@/features/workflow/queries";

function Conflict({ message, local, disk, reload, overwrite, saveAs }: {
  message: string; local: unknown; disk: unknown; reload: () => void; overwrite: () => Promise<unknown>; saveAs: () => Promise<unknown>;
}) {
  const [compare, setCompare] = React.useState(false);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const act = async (action: () => Promise<unknown>) => { setBusy(true); setError(""); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : "保存失败"); } finally { setBusy(false); } };
  return <div className="rounded border border-destructive/40 p-3 text-sm" role="alert">
    <p>{error || message}</p>
    <div className="mt-2 flex flex-wrap gap-2">
      <Button size="sm" variant="outline" onClick={() => setCompare(!compare)}>比较</Button>
      <Button size="sm" variant="outline" disabled={busy || !disk} onClick={reload}>重新载入磁盘版本</Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(saveAs)}>另存为副本</Button>
      <Button size="sm" variant="destructive" disabled={busy || !disk} onClick={() => void act(overwrite)}>用本地内容覆盖</Button>
    </div>
    {compare ? <div className="mt-2 grid max-h-64 grid-cols-2 gap-2 overflow-auto"><pre className="whitespace-pre-wrap text-xs">本地内容{"\n"}{JSON.stringify(local, null, 2)}</pre><pre className="whitespace-pre-wrap text-xs">磁盘内容{"\n"}{JSON.stringify(disk, null, 2)}</pre></div> : null}
  </div>;
}

export function NotebookConflict({ id }: { id: string }) {
  const session = useNotebookSession();
  const error = useNotebookSessionState((state) => state.saveError);
  const local = useNotebookSessionState((state) => state.draft);
  const disk = useNotebook(id);
  const save = useSaveNotebook();
  const create = useCreateNotebook();
  const router = useRouter();
  if (!error || !local) return null;
  return <Conflict message={error} local={local} disk={disk.data} reload={() => disk.data && session.reload(disk.data)}
    overwrite={async () => { const current = await disk.refetch(); if (!current.data) throw new Error("文件已删除，请另存为"); const saved = await save.mutateAsync({ ...local, fileVersion: current.data.fileVersion }); session.reload(saved); }}
    saveAs={async () => { const saved = await create.mutateAsync({ ...local, name: `${local.name} 副本`, filePath: undefined }); session.reload(disk.data ?? local); router.push(`/workbench/${saved.id}`); }} />;
}

export function WorkflowConflict({ id }: { id: string }) {
  const store = useEditorStoreApi();
  const error = useEditorStore((state) => state.conflict);
  const disk = useWorkflow(id);
  const save = useSaveWorkflow(store);
  const router = useRouter();
  if (!error) return null;
  const local = store.getState().toDoc();
  return <Conflict message={error} local={local} disk={disk.data} reload={() => disk.data && store.getState().load(disk.data)}
    overwrite={async () => { const current = await disk.refetch(); if (!current.data) throw new Error("文件已删除，请另存为"); const saved = await save.mutateAsync({ ...local, updatedAt: current.data.updatedAt, fileVersion: current.data.fileVersion }); store.getState().load(saved); }}
    saveAs={async () => { const saved = await save.mutateAsync({ ...local, id: "", filePath: undefined, fileVersion: undefined, name: `${local.name} 副本` }); router.push(`/workbench/workflow/${saved.id}`); }} />;
}
