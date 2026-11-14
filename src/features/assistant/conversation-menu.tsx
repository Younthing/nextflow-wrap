"use client";

import { History, Pencil, Plus, Trash2 } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AssistantConversation } from "./history";

export function ConversationMenu({ conversations, active, busy, onNew, onOpen, onRename, onDelete }: {
  conversations: AssistantConversation[];
  active: string;
  busy: boolean;
  onNew: () => void;
  onOpen: (id: string) => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button className="assistant-header-action" type="button" aria-label="新建对话" title="新建对话" disabled={busy} onClick={onNew}>
        <Plus className="size-4" />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="assistant-header-action" type="button" aria-label="对话历史" title="对话历史" disabled={busy}>
            <History className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="z-[1200] w-64">
          <DropdownMenuLabel>本机对话历史</DropdownMenuLabel>
          {conversations.length === 0 && <DropdownMenuItem disabled>还没有已保存的对话</DropdownMenuItem>}
          {conversations.map((item) => (
            <DropdownMenuItem key={item.id} onSelect={() => onOpen(item.id)}>
              <span className="min-w-0 flex-1 truncate">{item.title}</span>
              {item.id === active && <span className="shrink-0 text-xs text-primary">当前</span>}
            </DropdownMenuItem>
          ))}
          {conversations.some((item) => item.id === active) && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onRename}>
                <Pencil /> 重命名当前对话
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                <Trash2 /> 删除当前对话
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
