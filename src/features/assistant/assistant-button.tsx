"use client";

import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAssistantPanel } from "./assistant-provider";

/** Header button for the AI sidebar; says why when no model is configured. */
export function AssistantButton() {
  const { status, open, setOpen } = useAssistantPanel();
  const button = (
    <Button
      variant={open ? "default" : "ghost"}
      size="sm"
      aria-pressed={open}
      disabled={!status.enabled}
      onClick={() => setOpen(!open)}
    >
      <Sparkles /> AI 助手
    </Button>
  );
  if (status.enabled) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0}>{button}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{status.message}</TooltipContent>
    </Tooltip>
  );
}
