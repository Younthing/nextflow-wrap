"use client";

import * as React from "react";
import { Check, Info, Loader2, Square, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { RunConfirmView } from "./run-actions";

/** Above CopilotKit's sidebar (z-index 1100) so the confirm stays in front of the chat. */
const LAYER = "z-[1200]";

/**
 * ComfyUI confirmation dialog. Cancel is focused. Closing, Escape, or Cancel
 * resolves `null` and does not run the tool. Only the confirm button resolves
 * `true`. `info` has a single 好 button because the action cannot run.
 * Stop uses the destructive `delete` row, labeled 停止 rather than 删除.
 */
export function RunConfirmDialog({
  open,
  view,
  busy,
  onConfirm,
  onDismiss,
}: {
  open: boolean;
  view: RunConfirmView | null;
  busy: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  if (!view) return null;
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onDismiss(); }}>
      <DialogContent
        overlayClassName={LAYER}
        className={`${LAYER} sm:max-w-lg`}
        aria-busy={busy}
        onPointerDownOutside={(event) => { if (busy) event.preventDefault(); }}
        onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle className="font-serif">{view.title}</DialogTitle>
          <DialogDescription className="whitespace-pre-wrap text-sm text-foreground">{view.message}</DialogDescription>
        </DialogHeader>
        <section className="flex flex-col gap-6 break-words whitespace-pre-wrap">
          <div>
            {view.itemList.length > 0 && (
              <ul className="mt-2 flex list-disc flex-col gap-2 pl-4">
                {view.itemList.map((item, index) => (
                  <li key={`${index}:${item}`}>{item}</li>
                ))}
              </ul>
            )}
            {view.hint && (
              <div role="status" className="mt-2 flex items-start gap-2 text-sm text-muted-foreground">
                <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>{view.hint}</span>
              </div>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-4">
            {view.type === "info" ? (
              <Button autoFocus onClick={onDismiss} disabled={busy}>好</Button>
            ) : (
              <>
                <Button variant="secondary" autoFocus onClick={onDismiss} disabled={busy}>
                  <Undo2 /> 取消
                </Button>
                <Button variant={view.type === "delete" ? "destructive" : "default"} onClick={onConfirm} disabled={busy}>
                  {busy ? <Loader2 className="animate-spin" /> : view.type === "delete" ? <Square /> : <Check />}
                  {busy ? "正在提交" : view.type === "delete" ? "停止" : "确认"}
                </Button>
              </>
            )}
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}

export interface RunConfirmApi {
  view: RunConfirmView | null;
  busy: boolean;
  ask: (view: RunConfirmView) => Promise<true | null>;
  confirm: () => void;
  dismiss: () => void;
  close: () => void;
}

/** One confirmation at a time. Unmount, or asking after it, counts as cancel. */
export function useRunConfirm(): RunConfirmApi {
  const [view, setView] = React.useState<RunConfirmView | null>(null);
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false);
  const pending = React.useRef<((decision: true | null) => void) | null>(null);
  // True from the first render. The effect sets it again because Strict Mode
  // runs the cleanup once in development, and that cleanup must not stick.
  const mounted = React.useRef(true);

  const setBusyState = React.useCallback((value: boolean) => {
    busyRef.current = value;
    setBusy(value);
  }, []);

  const dismiss = React.useCallback(() => {
    if (busyRef.current) return;
    const resolve = pending.current;
    pending.current = null;
    setView(null);
    resolve?.(null);
  }, []);

  const confirm = React.useCallback(() => {
    if (busyRef.current || !pending.current) return;
    setBusyState(true);
    const resolve = pending.current;
    pending.current = null;
    resolve(true);
  }, [setBusyState]);

  const close = React.useCallback(() => {
    setBusyState(false);
    setView(null);
  }, [setBusyState]);

  const ask = React.useCallback((next: RunConfirmView) => {
    // Preparation can finish after the editor unmounts. The chat provider
    // stays mounted, so a promise with no dialog would never settle.
    if (!mounted.current || busyRef.current) return Promise.resolve(null);
    pending.current?.(null);
    pending.current = null;
    setBusyState(false);
    setView(next);
    return new Promise<true | null>((resolve) => {
      pending.current = resolve;
    });
  }, [setBusyState]);

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const resolve = pending.current;
      pending.current = null;
      resolve?.(null);
    };
  }, []);

  return { view, busy, ask, confirm, dismiss, close };
}

/** Closes the dialog when the assistant run is stopped, so a cancelled chat cannot confirm later. */
export function subscribeAbort(signal: AbortSignal | undefined, dismiss: () => void): () => void {
  if (!signal) return () => {};
  if (signal.aborted) {
    dismiss();
    return () => {};
  }
  const stop = () => dismiss();
  signal.addEventListener("abort", stop);
  return () => signal.removeEventListener("abort", stop);
}
