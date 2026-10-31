"use client";

import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FolderOpen,
  Play,
  Plus,
  Redo2,
  Save,
  Trash2,
  Undo2,
  Upload,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDeleteWorkflow, useWorkflows } from "@/features/workflow/queries";
import type { Issue } from "@/features/workflow/validate";
import { useShortcutLabel } from "@/lib/use-action-shortcuts";
import { cn } from "@/lib/utils";
import { EDITOR_ACTIONS } from "../commands";
import { EDITOR_CHROME_CLASS } from "../marquee-text";
import { selectIsDirty, useEditorStore } from "../store";

function IconButton({
  label,
  shortcut,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { label: string; shortcut?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {shortcut && <span className="ml-2 font-mono text-muted-foreground">{shortcut}</span>}
      </TooltipContent>
    </Tooltip>
  );
}

function IssuesBadge({ issues, onFocus }: { issues: Issue[]; onFocus: (nodeId: string) => void }) {
  const errors = issues.filter((i) => i.level === "error").length;
  const warnings = issues.length - errors;
  const Icon = errors ? XCircle : warnings ? AlertTriangle : CheckCircle2;
  const tone = errors ? "text-destructive" : warnings ? "text-warning" : "text-success";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className={cn("flex items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-accent", tone)}>
          <Icon className="size-4" />
          {errors || warnings ? `${errors} 个错误 · ${warnings} 个提醒` : "可以运行"}
        </button>
      </TooltipTrigger>
      {issues.length > 0 && (
        <TooltipContent side="bottom" className="max-w-sm p-1">
          <ul className="max-h-72 overflow-auto">
            {issues.map((issue, i) => (
              <li key={i}>
                <button
                  type="button"
                  disabled={!issue.nodeId}
                  onClick={() => issue.nodeId && onFocus(issue.nodeId)}
                  className="flex w-full items-start gap-1.5 rounded px-2 py-1 text-left hover:bg-accent"
                >
                  {issue.level === "error" ? (
                    <XCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                  ) : (
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
                  )}
                  {issue.message}
                </button>
              </li>
            ))}
          </ul>
        </TooltipContent>
      )}
    </Tooltip>
  );
}

function OpenWorkflowDialog({
  open,
  onOpenChange,
  currentId,
  onOpen,
  onNew,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentId: string;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  const { data: workflows, isPending } = useWorkflows();
  const del = useDeleteWorkflow();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>打开流程</DialogTitle>
          <DialogDescription>已保存的流程，按最近修改排序。</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-80 gap-1 overflow-auto">
          {isPending && <div className="text-sm text-muted-foreground">加载中…</div>}
          {workflows?.map((w) => (
            <div
              key={w.id}
              className={cn(
                "group flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-accent",
                w.id === currentId && "bg-accent",
              )}
            >
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpen(w.id)}>
                <div className="truncate text-sm font-medium">{w.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {w.nodeCount} 个节点 · {new Date(w.updatedAt).toLocaleString("zh-CN")}
                  {w.description && ` · ${w.description}`}
                </div>
              </button>
              {w.id !== currentId && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`删除 ${w.name}`}
                  className="opacity-0 group-hover:opacity-100"
                  onClick={() => del.mutate(w.id)}
                >
                  <Trash2 className="text-destructive" />
                </Button>
              )}
            </div>
          ))}
        </div>
        <Button variant="outline" onClick={onNew}>
          <Plus /> 新建空白流程
        </Button>
      </DialogContent>
    </Dialog>
  );
}

export function EditorToolbar({
  issues,
  saving,
  onSave,
  onOpen,
  onNew,
  onImport,
  onExport,
  onFocusNode,
  onRun,
}: {
  issues: Issue[];
  saving: boolean;
  onSave: () => void;
  onOpen: (id: string) => void;
  onNew: () => void;
  onImport: (file: File) => void;
  onExport: () => void;
  onFocusNode: (id: string) => void;
  onRun: () => void;
}) {
  const name = useEditorStore((s) => s.name);
  const setName = useEditorStore((s) => s.setName);
  const docId = useEditorStore((s) => s.docId);
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const dirty = useEditorStore(selectIsDirty);
  const saveShortcut = useShortcutLabel(EDITOR_ACTIONS.save.shortcut);
  const undoShortcut = useShortcutLabel(EDITOR_ACTIONS.undo.shortcut);
  const redoShortcut = useShortcutLabel(EDITOR_ACTIONS.redo.shortcut);
  const [openDialog, setOpenDialog] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);

  return (
    <div className={cn(EDITOR_CHROME_CLASS, "glass flex h-12 shrink-0 items-center gap-1 rounded-xl px-2")}>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label="流程名称"
        className="h-8 w-56 min-w-20 shrink rounded-md bg-transparent px-2 font-serif text-sm font-semibold outline-none hover:bg-accent focus:bg-accent"
      />
      <span
        className={cn("size-1.5 rounded-full", dirty ? "bg-warning" : "bg-success")}
        title={dirty ? "有未保存的修改" : "已保存"}
      />
      <Separator orientation="vertical" className="mx-1 !h-5" />
      <IconButton label="打开" onClick={() => setOpenDialog(true)}>
        <FolderOpen />
      </IconButton>
      <IconButton label={EDITOR_ACTIONS.save.label} shortcut={saveShortcut} onClick={onSave} disabled={saving}>
        <Save />
      </IconButton>
      <IconButton label={EDITOR_ACTIONS.undo.label} shortcut={undoShortcut} onClick={undo} disabled={!canUndo}>
        <Undo2 />
      </IconButton>
      <IconButton label={EDITOR_ACTIONS.redo.label} shortcut={redoShortcut} onClick={redo} disabled={!canRedo}>
        <Redo2 />
      </IconButton>
      <Separator orientation="vertical" className="mx-1 !h-5" />
      <IconButton label="导入 JSON" onClick={() => fileInput.current?.click()}>
        <Upload />
      </IconButton>
      <IconButton label="导出 JSON" onClick={onExport}>
        <Download />
      </IconButton>
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onImport(file);
          e.target.value = "";
        }}
      />
      <div className="ml-auto flex shrink-0 items-center gap-2 whitespace-nowrap">
        <IssuesBadge issues={issues} onFocus={onFocusNode} />
        <Button size="sm" onClick={onRun}>
          <Play /> 运行
        </Button>
      </div>
      <OpenWorkflowDialog
        open={openDialog}
        onOpenChange={setOpenDialog}
        currentId={docId}
        onOpen={(id) => {
          setOpenDialog(false);
          onOpen(id);
        }}
        onNew={() => {
          setOpenDialog(false);
          onNew();
        }}
      />
    </div>
  );
}
