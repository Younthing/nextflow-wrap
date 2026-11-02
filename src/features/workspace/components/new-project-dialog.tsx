"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { PathInput } from "@/features/files/components/path-input";
import { joinProjectPath, projectNameError } from "@/features/workspace/projects";
import type { CreateProjectRequest } from "@/features/workspace/types";

/** Name and location of a new project folder. The folder gets `data/` and `results/`. */
export function NewProjectDialog({
  open,
  onOpenChange,
  defaultParent,
  pending,
  error,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultParent: string;
  pending?: boolean;
  error?: string;
  onCreate: (request: CreateProjectRequest) => void;
}) {
  const [name, setName] = React.useState("");
  const [parent, setParent] = React.useState(defaultParent);
  const [touched, setTouched] = React.useState(false);
  const [seededParent, setSeededParent] = React.useState(defaultParent);
  if (defaultParent !== seededParent) {
    setSeededParent(defaultParent);
    if (!parent) setParent(defaultParent);
  }
  const nameError = touched ? projectNameError(name) : undefined;
  const target = name.trim() && parent.trim() ? joinProjectPath(parent, name) : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>新建项目</DialogTitle>
          <DialogDescription>项目就是磁盘上的一个文件夹。里面会建好 data/ 和 results/，笔记本也归在这个项目下。</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setTouched(true);
            if (projectNameError(name) || !parent.trim()) return;
            onCreate({ name: name.trim(), parent: parent.trim() });
          }}
        >
          <FormField label="项目名称" htmlFor="new-project-name">
            <Input
              id="new-project-name"
              autoFocus
              value={name}
              placeholder="例如 PBMC 单细胞图谱"
              aria-invalid={nameError ? true : undefined}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => setTouched(true)}
            />
          </FormField>
          {nameError ? <p role="alert" className="-mt-2 text-xs text-destructive">{nameError}</p> : null}
          <FormField label="位置" htmlFor="new-project-parent">
            <PathInput id="new-project-parent" kind="directory" value={parent} onChange={setParent} aria-label="位置" />
          </FormField>
          {target ? <p className="-mt-2 truncate font-mono text-[11px] text-muted-foreground" title={target}>将创建 {target}</p> : null}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="glass" onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              创建并打开
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
