"use client";

import { Sparkles } from "lucide-react";

import { sidebarItemClass } from "@/components/layout/sidebar-item";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAssistantPanel } from "./assistant-provider";

/** Sidebar row that opens the AI panel; says why when no model is configured. */
export function AssistantButton({ collapsed = false }: { collapsed?: boolean }) {
  const { status, open, setOpen } = useAssistantPanel();
  const button = (
    <button
      type="button"
      aria-pressed={open}
      aria-label={collapsed ? "AI 助手" : undefined}
      disabled={!status.enabled}
      className={sidebarItemClass(open, collapsed)}
      onClick={() => setOpen(!open)}
    >
      <Sparkles />
      {collapsed ? null : "AI 助手"}
    </button>
  );
  const hint = status.enabled ? status.detail : status.message;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {status.enabled ? button : <span tabIndex={0} className="block">{button}</span>}
      </TooltipTrigger>
      <TooltipContent side="right">{collapsed ? `AI 助手 · ${hint}` : hint}</TooltipContent>
    </Tooltip>
  );
}
