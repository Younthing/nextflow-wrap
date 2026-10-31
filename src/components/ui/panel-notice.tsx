import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

export function PanelNotice({
  message,
  tone = "muted",
  children,
  className,
}: {
  message: string;
  tone?: "muted" | "danger";
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "glass flex size-full flex-col items-center justify-center gap-3 rounded-xl text-sm",
        className,
      )}
    >
      <span
        role={tone === "danger" ? "alert" : undefined}
        className={
          tone === "danger" ? "text-destructive" : "text-muted-foreground"
        }
      >
        {message}
      </span>
      {children}
    </div>
  );
}

export function PanelLoading({
  message,
  className,
}: {
  message?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn(
        "glass grid size-full place-items-center rounded-xl text-sm text-muted-foreground",
        className,
      )}
    >
      <span className="flex items-center gap-2">
        <Loader2
          className={cn("animate-spin", message ? "size-4" : "size-5")}
          aria-hidden="true"
        />
        <span className={message ? undefined : "sr-only"}>
          {message || "加载中"}
        </span>
      </span>
    </div>
  );
}
