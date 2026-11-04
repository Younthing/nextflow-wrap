"use client";

import * as React from "react";
import {
  useAgentContext,
  useConfigureSuggestions,
  useFrontendTool,
  type JsonSerializable,
} from "@copilotkit/react-core/v2";
import { z } from "zod";

import {
  NOTEBOOK_CELL_KINDS,
  createNotebookActions,
  notebookSummary,
  notebookVariablesContext,
} from "@/features/notebook/assistant-actions";
import { useNotebookSession, useNotebookSessionState } from "@/features/notebook/session-provider";
import { useAssistantStatus } from "../assistant-provider";
import { codeReference, useComposerReferences, type ComposerReferences } from "../composer";
import { attempt } from "./attempt";
import { clipReason } from "../confirm";
import { useConfirmedTool } from "../confirmed-tool";
import { ConfirmToolCard } from "../confirm-tool-card";
import { useAssistantModule } from "../modules/activation";
import { moduleTool } from "../modules/contract";
import { notebookModule } from "../modules/notebook";

function NotebookTools() {
  const session = useNotebookSession();
  const actions = React.useMemo(() => createNotebookActions(session), [session]);
  const { invoke, dialog } = useConfirmedTool();
  const doc = useNotebookSessionState((state) => state.draft ?? state.saved);
  const outputs = useNotebookSessionState((state) => state.outputs);
  const busy = useNotebookSessionState((state) => state.running !== null);
  // Recomputed on every draft edit or new output, so each chat turn sees the notebook as it is.
  const summary = React.useMemo(() => (doc ? notebookSummary({ doc, outputs, busy }) : null), [doc, outputs, busy]);

  useAgentContext({
    description: "用户正在编辑的笔记本：单元格 id、类型、内容预览和输出状态",
    value: summary as unknown as JsonSerializable,
  });

  // Kernel variables: names in the context, and chips above the chat input that insert `name`.
  const variables = useNotebookSessionState((state) => state.variables);
  useAgentContext({
    description: "笔记本常驻内核里的用户变量（变量名: 类型 (大小)），或读不到变量的原因",
    value: React.useMemo(() => notebookVariablesContext(variables), [variables]) as unknown as JsonSerializable,
  });
  const references = React.useMemo<ComposerReferences | null>(() => {
    if (!variables) return null;
    return {
      title: "变量",
      items: variables.variables.map((item) => ({
        label: item.name,
        detail: `${item.type}${item.size ? ` · ${item.size}` : ""}`,
        text: codeReference(item.name),
      })),
      note: variables.available ? "内核里还没有变量" : variables.reason,
      onRefresh: () => void session.refreshVariables(),
    };
  }, [variables, session]);
  useComposerReferences(references);

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
    handler: async () => attempt(() => actions.summary()),
  }, [actions]);

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
    handler: async (args) => attempt(() => actions.editCell(args)),
  }, [actions]);

  useFrontendTool({
    name: moduleTool(notebookModule, "run_notebook_cell").name,
    description: moduleTool(notebookModule, "run_notebook_cell").description,
    parameters: z.object({
      cellId: z.string().describe("要运行的代码单元格 id"),
      reason: z.string().optional().describe("展示在确认对话框里的一句话。不能代替用户确认。"),
    }),
    handler: (args, context) =>
      invoke(context, {
        interruptedMessage: "确认被中断，没有运行。",
        prepare: () => actions.prepareRunCell(args.cellId, clipReason(args.reason)),
      }),
    render: ConfirmToolCard,
  }, [actions, invoke]);

  useFrontendTool({
    name: moduleTool(notebookModule, "read_cell_output").name,
    description: moduleTool(notebookModule, "read_cell_output").description,
    parameters: z.object({ cellId: z.string().describe("单元格 id") }),
    handler: async ({ cellId }) => attempt(() => actions.readOutput(cellId)),
  }, [actions]);

  useFrontendTool({
    name: moduleTool(notebookModule, "list_notebook_variables").name,
    description: moduleTool(notebookModule, "list_notebook_variables").description,
    parameters: z.object({}),
    handler: async () => attempt(() => actions.listVariables()),
  }, [actions]);

  useFrontendTool({
    name: moduleTool(notebookModule, "get_notebook_variable").name,
    description: moduleTool(notebookModule, "get_notebook_variable").description,
    parameters: z.object({ name: z.string().describe("变量名，如 df") }),
    handler: async ({ name }) => attempt(() => actions.getVariable(name)),
  }, [actions]);

  return dialog;
}

/**
 * Notebook module surface: mounts the module and registers its tools over the
 * open notebook session, the way vscode-jupyter tools call the notebook
 * document and kernel provider rather than reaching into an editor.
 */
export function NotebookAssistant() {
  useAssistantModule(notebookModule.id);
  if (!useAssistantStatus().enabled) return null;
  return <NotebookTools />;
}
