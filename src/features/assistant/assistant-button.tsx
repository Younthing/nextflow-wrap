"use client";

import { LoaderCircle, Sparkles } from "lucide-react";

import { sidebarItemClass } from "@/components/layout/sidebar-item";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAssistantPanel } from "./assistant-provider";

/** Sidebar row that opens the AI panel; spins while the status is checked and says why when no model is configured. */
export function AssistantButton({ collapsed = false }: { collapsed?: boolean }) {
  const { status, checking, open, setOpen } = useAssistantPanel();
  const button = (
    <button
      type="button"
      aria-pressed={open}
      aria-label={collapsed ? "AI 助手" : undefined}
      disabled={!status.enabled}
      aria-busy={checking || undefined}
      className={sidebarItemClass(open, collapsed)}
      onClick={() => setOpen(!open)}
    >
      {checking ? <LoaderCircle className="animate-spin" aria-hidden /> : <Sparkles />}
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
