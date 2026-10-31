import type { ReactNode } from "react";

import { Label } from "./label";

export function FormField({
  label,
  htmlFor,
  children,
  hint,
}: {
  label: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="grid gap-1.5">
      {typeof label === "string" ? (
        <Label htmlFor={htmlFor} className="text-xs">
          {label}
        </Label>
      ) : (
        label
      )}
      {children}
      {hint && (
        <p
          id={htmlFor ? `${htmlFor}-hint` : undefined}
          className="text-[11px] text-muted-foreground"
        >
          {hint}
        </p>
      )}
    </div>
  );
}
