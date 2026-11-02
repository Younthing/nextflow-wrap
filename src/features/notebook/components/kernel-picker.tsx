"use client";

import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
import { Popover } from "radix-ui";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useKernelSpecs } from "@/features/notebook/queries";
import { kernelChoices } from "@/features/notebook/kernel-choices";
import { kernelLabel, normalizeKernelName } from "@/features/notebook/types";
import { mockingActive } from "@/lib/mocking";
import { cn } from "@/lib/utils";

export function KernelPicker({
  value,
  disabled,
  onChange,
  subtle = false,
}: {
  value: string;
  disabled?: boolean;
  onChange: (kernel: string) => void;
  /** Quiet pill for the workbench toolbar; the "内核" label stays for screen readers. */
  subtle?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [custom, setCustom] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [error, setError] = React.useState("");
  const specs = useKernelSpecs();
  // The same list as the workbench's runtimes: installed kernels, plus this notebook's kernel if it is not one.
  const choices = kernelChoices(specs.data?.kernels ?? [], { demo: mockingActive(), inUse: [value] });
  const current = choices.find((choice) => choice.name === value);

  const choose = (kernel: string) => {
    onChange(kernel);
    setOpen(false);
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setCustom(false);
          setDraft("");
          setError("");
        }
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "inline-flex h-8 max-w-full items-center gap-2 rounded-md border px-2.5 text-xs text-foreground",
            subtle ? "border-border bg-glass-strong hover:bg-accent" : "border-primary bg-primary/10 hover:bg-primary/15",
            "focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          <span className={cn(subtle ? "sr-only" : "text-muted-foreground")}>内核</span>
          <span className="size-1.5 shrink-0 rounded-full bg-success" aria-hidden />
          <span className={cn("truncate", subtle ? "font-medium" : "font-semibold")}>{current?.label ?? kernelLabel(value)}</span>
          <ChevronDown className="size-3.5 shrink-0 opacity-70" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 w-72 rounded-lg border border-border bg-background p-1 text-foreground shadow-lg outline-none"
        >
          <div role="listbox" aria-label="内核" className="grid gap-0.5">
            {choices.map((choice) => (
              <KernelOption
                key={choice.name}
                selected={choice.name === value}
                label={choice.missing ? `${choice.label} · 未安装` : choice.label}
                onSelect={() => choose(choice.name)}
              />
            ))}
          </div>
          {specs.data && !specs.data.available && (
            <p className="px-2.5 py-1.5 text-[11px] text-muted-foreground">
              未检测到 Jupyter：<span className="font-mono">python3 -m pip install ipykernel</span>
            </p>
          )}
          <div className="mt-1 border-t border-border pt-1">
            {custom ? (
              <form
                className="grid gap-1.5 p-1"
                onSubmit={(event) => {
                  event.preventDefault();
                  try {
                    choose(normalizeKernelName(draft));
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "无法使用这个内核");
                  }
                }}
              >
                <Input
                  autoFocus
                  value={draft}
                  aria-label="自定义内核"
                  placeholder="例如 python:3.12"
                  onChange={(event) => {
                    setDraft(event.target.value);
                    setError("");
                  }}
                  className="h-8 font-mono text-xs"
                />
                {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
                <Button type="submit" size="sm" variant="outline">使用</Button>
              </form>
            ) : (
              <button
                type="button"
                className="flex w-full rounded-md px-2.5 py-2 text-left text-xs text-primary hover:bg-accent"
                onClick={() => setCustom(true)}
              >
                选其他…
              </button>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function KernelOption({
  selected,
  label,
  onSelect,
}: {
  selected: boolean;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-xs",
        selected ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
      onClick={onSelect}
    >
      <span>{label}</span>
      {selected ? <Check className="size-3.5 text-primary" aria-hidden /> : null}
    </button>
  );
}
