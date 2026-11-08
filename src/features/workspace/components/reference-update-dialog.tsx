"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useSaveWorkflow } from "@/features/workflow/queries";
import type { ReferenceUpdate } from "../reference-updates";

export function ReferenceUpdateDialog() {
  const [plans, setPlans] = React.useState<ReferenceUpdate[]>([]);
  const [error, setError] = React.useState("");
  const save = useSaveWorkflow();
  React.useEffect(() => {
    const listener = (event: Event) => { setPlans((event as CustomEvent<ReferenceUpdate[]>).detail); setError(""); };
    window.addEventListener("studio-reference-updates", listener);
    return () => window.removeEventListener("studio-reference-updates", listener);
  }, []);
  return <Dialog open={plans.length > 0} onOpenChange={(open) => { if (!open) setPlans([]); }}>
    <DialogContent><DialogHeader><DialogTitle>更新流程中的文件引用？</DialogTitle></DialogHeader>
      <p className="text-sm text-muted-foreground">文件已移动。以下更新只涉及流程声明的文件输入；代码中的路径保持原样。</p>
      <ul className="grid max-h-64 gap-2 overflow-auto text-sm">{plans.map((plan) => <li key={plan.document.id}><p className="font-medium">{plan.document.filePath ?? plan.document.name}</p>{plan.changes.map((change) => <p className="font-mono text-xs" key={change.field}>{change.before} → {change.after}</p>)}</li>)}</ul>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <DialogFooter><Button variant="ghost" onClick={() => setPlans([])}>保留原引用</Button><Button disabled={save.isPending} onClick={async () => {
        const remaining = [...plans];
        try {
          for (const plan of plans) { await save.mutateAsync(plan.document); remaining.shift(); }
          setPlans([]);
        } catch (e) { setPlans(remaining); setError(e instanceof Error ? e.message : "更新失败，未完成的引用已保留"); }
      }}>更新引用</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
