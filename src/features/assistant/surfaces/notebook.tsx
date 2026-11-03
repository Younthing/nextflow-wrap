"use client";

import * as React from "react";
import {
  useAgentContext,
  useConfigureSuggestions,
  useFrontendTool,
  type FrontendToolHandlerContext,
  type JsonSerializable,
} from "@copilotkit/react-core/v2";
import { z } from "zod";

import type { CellRunResult, NotebookDoc } from "@/features/notebook/types";
import {
  NOTEBOOK_CELL_KINDS,
  createNotebookActions,
  notebookSummary,
  runCellBlockers,
  runCellConfirmView,
  type NotebookCommands,
  type RanNotebookCell,
} from "@/features/notebook/assistant-actions";
import { useAssistantPanel, useAssistantStatus } from "../assistant-provider";
import { attempt } from "./attempt";
import { clipReason, confirmThenRun, createConfirmQueue, declinedResult, type ConfirmedResult } from "../confirm";
import { ConfirmDialog, subscribeAbort, useConfirmDialog } from "../confirm-dialog";
import { ConfirmToolCard } from "../confirm-tool-card";
import { useAssistantModule } from "../modules/activation";
import { moduleTool } from "../modules/contract";
import { notebookModule } from "../modules/notebook";

type Live = React.RefObject<{
  commands: NotebookCommands;
  confirm: ReturnType<typeof useConfirmDialog>;
  setOpen: (open: boolean) => void;
}>;

interface NotebookAssistantProps {
  /** Draft, outputs, and busy flag as rendered, for the chat context. Tools read through `commands`. */
  doc: NotebookDoc;
  outputs: Readonly<Record<string, CellRunResult>>;
  busy: boolean;
  commands: NotebookCommands;
}

/** Tool handlers build actions over the latest editor commands, read at call time. */
function actionsOf(live: Live) {
  return createNotebookActions(live.current.commands);
}

function NotebookTools({ doc, outputs, busy, commands }: NotebookAssistantProps) {
  const confirm = useConfirmDialog();
  const { setOpen } = useAssistantPanel();
  const live: Live = React.useRef({ commands, confirm, setOpen });
  const queue = React.useRef(createConfirmQueue());
  React.useLayoutEffect(() => {
    live.current = { commands, confirm, setOpen };
  });
  // Recomputed on every draft edit or new output, so each chat turn sees the notebook as it is.
  const summary = React.useMemo(() => notebookSummary({ doc, outputs, busy }), [doc, outputs, busy]);

  useAgentContext({
    description: "用户正在编辑的笔记本：单元格 id、类型、内容预览和输出状态",
    value: summary as unknown as JsonSerializable,
  });

  useConfigureSuggestions({
    suggestions: [
      { title: "解释这本笔记本", message: "用几句话解释这本笔记本每一格在做什么" },
      { title: "修复报错", message: "看看哪一格报错了，修好并重新运行" },
      { title: "标出端口", message: "帮我把这本笔记本的输入和输出端口标出来" },
    ],
  });

  useFrontendTool({
    name: moduleTool(notebookModule, "get_notebook_summary").name,
    description: moduleTool(notebookModule, "get_notebook_summary").description,
    parameters: z.object({}),
    handler: async () => attempt(() => actionsOf(live).summary()),
  });

  useFrontendTool({
    name: moduleTool(notebookModule, "edit_notebook_cell").name,
    description: moduleTool(notebookModule, "edit_notebook_cell").description,
    parameters: z.object({
      editType: z.enum(["insert", "delete", "edit"]),
      cellId: z
        .string()
        .optional()
        .describe("edit / delete 的目标单元格 id；insert 时是插在哪一格之后，或 TOP / BOTTOM"),
      kind: z.enum(NOTEBOOK_CELL_KINDS).optional().describe("单元格类型。insert 默认 code"),
      source: z.string().optional().describe("单元格完整内容"),
    }),
    handler: async (args) => attempt(() => actionsOf(live).editCell(args)),
  });

  useFrontendTool({
    name: moduleTool(notebookModule, "run_notebook_cell").name,
    description: moduleTool(notebookModule, "run_notebook_cell").description,
    parameters: z.object({
      cellId: z.string().describe("要运行的代码单元格 id"),
      reason: z.string().optional().describe("展示在确认对话框里的一句话。不能代替用户确认。"),
    }),
    handler: (args, context) => queue.current(() => runCell(args.cellId, args.reason, context, live)),
    render: ConfirmToolCard,
  });

  useFrontendTool({
    name: moduleTool(notebookModule, "read_cell_output").name,
    description: moduleTool(notebookModule, "read_cell_output").description,
    parameters: z.object({ cellId: z.string().describe("单元格 id") }),
    handler: async ({ cellId }) => attempt(() => actionsOf(live).readOutput(cellId)),
  });

  return (
    <ConfirmDialog
      open={confirm.view !== null}
      view={confirm.view}
      busy={confirm.busy}
      onConfirm={confirm.confirm}
      onDismiss={confirm.dismiss}
    />
  );
}

async function runCell(
  cellId: string,
  reason: unknown,
  context: FrontendToolHandlerContext | undefined,
  live: Live,
): Promise<ConfirmedResult<RanNotebookCell>> {
  if (context?.isReplay) return declinedResult("页面恢复了未完成的确认，没有再次执行。请再说一次。");
  const current = live.current;
  if (context?.signal?.aborted) return declinedResult("确认被中断，没有运行。");
  current.setOpen(true);
  const opened = current.commands.read();
  const problems = runCellBlockers(opened, cellId);
  const stopAbort = subscribeAbort(context?.signal, () => current.confirm.dismiss());
  try {
    return await confirmThenRun({
      isReplay: false,
      aborted: () => context?.signal?.aborted === true,
      ask: (view) => current.confirm.ask(view),
      close: () => current.confirm.close(),
      view: runCellConfirmView(opened.doc, cellId, problems, clipReason(reason)),
      problems: () => {
        const latest = live.current.commands.read();
        if (latest.doc.id !== opened.doc.id) return ["当前页面已经不是这本笔记本，没有运行。"];
        const before = opened.doc.cells.find((cell) => cell.id === cellId)?.source;
        const now = latest.doc.cells.find((cell) => cell.id === cellId)?.source;
        if (before !== now) return ["确认时单元格内容已变化，没有运行。请再试一次。"];
        return runCellBlockers(latest, cellId);
      },
      execute: () => actionsOf(live).runCell(cellId),
      interruptedMessage: "确认被中断，没有运行。",
    });
  } finally {
    stopAbort();
  }
}

/**
 * Notebook module surface: mounts the module and registers its tools on top of
 * the editor's command API, the way vscode-jupyter registers tools that call
 * its kernel provider rather than reaching into the editor.
 */
export function NotebookAssistant(props: NotebookAssistantProps) {
  useAssistantModule(notebookModule.id);
  if (!useAssistantStatus().enabled) return null;
  return <NotebookTools {...props} />;
}
