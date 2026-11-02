"use client";

import { CheckCircle2, CircleAlert, CircleDashed, Download, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ToolStatus } from "../types";

const ICON = {
  ok: CheckCircle2,
  missing: CircleDashed,
  installing: Loader2,
  error: CircleAlert,
} as const;

/** One row per tool: what was found, where, and a one-click install when the app can do it. */
export function ToolChecklist({
  tools,
  onInstall,
  installing,
}: {
  tools: ToolStatus[];
  onInstall?: (tool: ToolStatus) => void;
  /** Tool whose install request is in flight. */
  installing?: string;
}) {
  return (
    <ul className="flex flex-col divide-y divide-border/60" aria-label="运行环境检查">
      {tools.map((tool) => {
        const Icon = ICON[tool.state];
        const busy = tool.state === "installing" || installing === tool.id;
        return (
          <li key={tool.id} className="flex flex-col gap-2 py-3" aria-label={tool.label}>
            <div className="flex items-start gap-3">
              <Icon
                aria-hidden="true"
                className={cn(
                  "mt-0.5 size-5 shrink-0",
                  tool.state === "ok" && "text-success",
                  tool.state === "missing" && (tool.required ? "text-warning" : "text-muted-foreground"),
                  tool.state === "installing" && "animate-spin text-primary",
                  tool.state === "error" && "text-destructive",
                )}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{tool.label}</span>
                  {tool.required ? <Badge variant="outline">必需</Badge> : <Badge variant="secondary">可选</Badge>}
                  {tool.source === "managed" && <Badge>应用安装</Badge>}
                  {tool.version && <span className="font-mono text-xs text-muted-foreground">{tool.version}</span>}
                </div>
                {tool.path && <span className="truncate font-mono text-xs text-muted-foreground" title={tool.path}>{tool.path}</span>}
                {tool.detail && (
                  <span className={cn("text-xs", tool.state === "error" ? "text-destructive" : "text-muted-foreground")}>{tool.detail}</span>
                )}
              </div>
              {tool.state !== "ok" && tool.install && onInstall && (
                <Button size="sm" variant={tool.required ? "default" : "glass"} disabled={busy} onClick={() => onInstall(tool)}>
                  {busy ? <Loader2 className="animate-spin" /> : <Download />}
                  {busy ? "安装中" : tool.state === "error" ? "重试" : tool.install.label}
                </Button>
              )}
            </div>
            {tool.log && tool.log.length > 0 && (
              <pre className="glass ml-8 max-h-32 overflow-auto rounded-md p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
                {tool.log.join("\n")}
              </pre>
            )}
          </li>
        );
      })}
    </ul>
  );
}
