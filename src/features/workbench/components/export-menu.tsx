"use client";

import { Boxes, ChevronDown, FileCode2, FileJson, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { CellRunResult, NotebookDoc } from "@/features/notebook/types";
import { portSummary, toIpynb, toScript } from "@/features/workbench/export";
import { saveTextFile } from "@/lib/save-file";
import { toast } from "@/lib/toast";

/**
 * 导出: files first (.ipynb with this session's outputs, a percent script), then the optional way into pipelines.
 * Exporting a module is one choice among the others, not a step every notebook has to take.
 */
export function ExportMenu({
  doc,
  outputs,
  ports,
  disabled,
  onExportModule,
}: {
  doc: Pick<NotebookDoc, "name" | "description" | "kernel" | "language" | "cells">;
  outputs: Record<string, CellRunResult>;
  ports: { inputs: number; outputs: number };
  disabled?: boolean;
  onExportModule: () => void;
}) {
  const save = (file: { name: string; type: string; content: string }) => {
    try {
      saveTextFile(file.name, file.type, file.content);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "导出失败");
    }
  };
  const script = doc.language === "r" ? ".R 脚本" : ".py 脚本";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="sm" variant="glass" disabled={disabled}>
          <Upload />
          导出
          <ChevronDown className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel>文件</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => save(toIpynb(doc, outputs))}>
            <FileJson />
            Jupyter 笔记本 (.ipynb)
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => { try { save(toScript(doc)); } catch (error) { toast.error(error instanceof Error ? error.message : "导出失败"); } }}>
            <FileCode2 />
            {script}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>复用</DropdownMenuLabel>
          <DropdownMenuItem onSelect={onExportModule}>
            <Boxes />
            <span className="grid">
              导出为模块…
              <span className="text-[11px] text-muted-foreground">
                {portSummary(ports.inputs, ports.outputs)}
              </span>
            </span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
