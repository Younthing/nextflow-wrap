import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

type AsyncPlaceholderBase = {
  className?: string;
};

export type AsyncPlaceholderProps =
  | (AsyncPlaceholderBase & {
      status: "pending";
      /** Visible label. Omit it to keep “加载中” available to assistive tech only. */
      message?: string;
    })
  | (AsyncPlaceholderBase & {
      status: "error";
      /** Finished alert text, including any call-site prefix around `error.message`. */
      message: string;
    })
  | (AsyncPlaceholderBase & {
      status: "empty";
      icon?: ReactNode;
      description?: ReactNode;
      /** Action control, usually a button or link. */
      children?: ReactNode;
    });

const frame =
  "flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center text-sm";

/** Inner pending, error, or empty state for a panel that already has its surface. */
export function AsyncPlaceholder(props: AsyncPlaceholderProps) {
  if (props.status === "pending") {
    return (
      <div
        role="status"
        className={cn(frame, "text-muted-foreground", props.className)}
      >
        <span className="flex items-center gap-2">
          <Loader2
            className={cn("animate-spin", props.message ? "size-4" : "size-5")}
            aria-hidden="true"
          />
          <span className={props.message ? undefined : "sr-only"}>
            {props.message || "加载中"}
          </span>
        </span>
      </div>
    );
  }

  if (props.status === "error") {
    return (
      <div
        role="alert"
        className={cn(frame, "text-destructive", props.className)}
      >
        <p className="w-full max-w-md break-words">{props.message}</p>
      </div>
    );
  }

  return (
    <div className={cn(frame, "text-muted-foreground", props.className)}>
      {props.icon ? (
        <span aria-hidden="true" className="[&_svg:not([class*='size-'])]:size-8">
          {props.icon}
        </span>
      ) : null}
      {props.description ? (
        <p className="w-full max-w-md break-words">{props.description}</p>
      ) : null}
      {props.children}
    </div>
  );
}
