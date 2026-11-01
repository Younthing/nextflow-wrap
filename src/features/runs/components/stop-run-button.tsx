"use client";

import * as React from "react";
import { Loader2, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Above the assistant sidebar (z-index 1100) so the confirm stays in front. */
const LAYER = "z-[1200]";

export function StopRunButton({
  runName,
  pending = false,
  disabled = false,
  onStop,
}: {
  runName: string;
  pending?: boolean;
  disabled?: boolean;
  onStop: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" disabled={disabled || pending} onClick={() => setOpen(true)}>
        {pending ? <Loader2 className="animate-spin" /> : <Square />}
        停止
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent overlayClassName={LAYER} className={`${LAYER} sm:max-w-md`}>
          <DialogHeader>
            <DialogTitle>停止运行</DialogTitle>
            <DialogDescription>
              确认停止「{runName}」？正在执行的任务会被中止，已经完成的结果会保留。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => {
                setOpen(false);
                onStop();
              }}
            >
              确认停止
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
