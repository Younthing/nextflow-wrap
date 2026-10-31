"use client";

import type { ComponentProps } from "react";
import Link from "next/link";
import { ArrowLeft, Play, Redo2, Scan, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
}: ComponentProps<typeof Button> & { label: string; shortcut?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" type="button" aria-label={label} {...props}>
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

export function EditorToolbar({
  saving,
  onFit,
  onRun,
}: {
  saving: boolean;
  onFit: () => void;
  onRun: () => void;
}) {
  const name = useEditorStore((s) => s.name);
  const setName = useEditorStore((s) => s.setName);
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);
  const canFit = useEditorStore((s) => s.nodes.length > 0);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const dirty = useEditorStore(selectIsDirty);
  const saveShortcut = useShortcutLabel(EDITOR_ACTIONS.save.shortcut);
  const undoShortcut = useShortcutLabel(EDITOR_ACTIONS.undo.shortcut);
  const redoShortcut = useShortcutLabel(EDITOR_ACTIONS.redo.shortcut);
  const fitShortcut = useShortcutLabel(EDITOR_ACTIONS.fit.shortcut);
  const saveLabel = saving ? "保存中" : dirty ? "未保存" : "已保存";

  return (
    <div className={cn(EDITOR_CHROME_CLASS, "glass flex h-12 shrink-0 items-center gap-1 rounded-xl px-2")}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button asChild variant="ghost" size="icon-sm" className="shrink-0">
            <Link href="/workflows" aria-label="返回流程库">
              <ArrowLeft />
            </Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent>返回流程库</TooltipContent>
      </Tooltip>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label="流程名称"
        className="h-8 w-56 min-w-20 shrink rounded-md bg-transparent px-2 font-serif text-sm font-semibold outline-none hover:bg-accent focus:bg-accent"
      />
      <span
        className={cn(
          "flex shrink-0 items-center gap-1.5 px-1 text-xs",
          dirty ? "text-warning" : "text-muted-foreground",
        )}
        title={saving ? "正在保存" : dirty ? `有未保存的修改（${saveShortcut}）` : "已保存"}
      >
        <span className={cn("size-1.5 rounded-full", saving || dirty ? "bg-warning" : "bg-success", saving && "animate-pulse")} />
        {saveLabel}
      </span>
      <Separator orientation="vertical" className="mx-1 !h-5" />
      <IconButton label={EDITOR_ACTIONS.undo.label} shortcut={undoShortcut} onClick={undo} disabled={!canUndo}>
        <Undo2 />
      </IconButton>
      <IconButton label={EDITOR_ACTIONS.redo.label} shortcut={redoShortcut} onClick={redo} disabled={!canRedo}>
        <Redo2 />
      </IconButton>
      <IconButton label={EDITOR_ACTIONS.fit.label} shortcut={fitShortcut} onClick={onFit} disabled={!canFit}>
        <Scan />
      </IconButton>
      <div className="ml-auto flex shrink-0 items-center gap-2 whitespace-nowrap">
        <Button size="sm" type="button" onClick={onRun}>
          <Play /> 运行
        </Button>
      </div>
    </div>
  );
}
