"use client";

import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
import { Popover } from "radix-ui";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useKernelSpecs } from "@/features/notebook/queries";
import { KERNELS, kernelLabel, normalizeKernelName, type KernelId } from "@/features/notebook/types";
import { cn } from "@/lib/utils";

const KERNEL_IDS = Object.keys(KERNELS) as KernelId[];

export function KernelPicker({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (kernel: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [custom, setCustom] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [error, setError] = React.useState("");
  const specs = useKernelSpecs();
  const jupyter = (specs.data?.kernels ?? []).filter((spec) => !(spec.name in KERNELS));
  const known = value in KERNELS || jupyter.some((spec) => spec.name === value);

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
            "inline-flex h-8 max-w-full items-center gap-2 rounded-md border border-primary bg-primary/10 px-2.5 text-xs text-foreground",
            "hover:bg-primary/15 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          <span className="text-muted-foreground">内核</span>
          <span className="size-1.5 shrink-0 rounded-full bg-success" aria-hidden />
          <span className="truncate font-semibold">{kernelLabel(value)}</span>
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
            {!known && (
              <KernelOption selected label={kernelLabel(value)} onSelect={() => choose(value)} />
            )}
            {KERNEL_IDS.map((id) => (
              <KernelOption
                key={id}
                selected={id === value}
                label={KERNELS[id].label}
                onSelect={() => choose(id)}
              />
            ))}
            {jupyter.length > 0 && (
              <p className="px-2.5 pt-2 pb-1 text-[11px] text-muted-foreground">本机 Jupyter 内核</p>
            )}
            {jupyter.map((spec) => (
              <KernelOption
                key={spec.name}
                selected={spec.name === value}
                label={spec.displayName === spec.name ? spec.name : `${spec.displayName} · ${spec.name}`}
                onSelect={() => choose(spec.name)}
              />
            ))}
          </div>
          {specs.data && !specs.data.available && (
            <p className="px-2.5 py-1.5 text-[11px] text-muted-foreground">
              未检测到 Jupyter，单元格每次从头运行。安装后可用常驻内核：
              <span className="font-mono">python3 -m pip install ipykernel</span>
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
