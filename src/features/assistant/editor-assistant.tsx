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
  useEditorStore,
  useEditorStoreApi,
} from "@/features/editor/editor-provider";
import { useAssistantStatus } from "./assistant-provider";
import { createEditorActions } from "./editor-actions";
import { useAssistantModule } from "./modules/activation";
import { canvasEditModule } from "./modules/canvas-edit";
import { moduleTool } from "./modules/contract";
import { StartRunTool } from "./start-run-tool";

const widgetValue = z.union([z.string(), z.number(), z.boolean()]);

/** Runs an action and hands the model either its result or the error to fix. */
function attempt<T>(fn: () => T): Promise<T | { error: string }> {
  try {
    return Promise.resolve(fn());
  } catch (err) {
    return Promise.resolve({ error: (err as Error).message });
  }
}

function EditorTools({ onCanvasChange }: { onCanvasChange: () => void }) {
  const store = useEditorStoreApi();
  const {
    addModule,
    configureNode,
    connectNodes,
    disconnect,
    removeNode,
    searchCatalog,
    setParam,
    workflowSummary,
  } = React.useMemo(() => createEditorActions(store), [store]);
  const nodes = useEditorStore((s) => s.nodes);
  const edges = useEditorStore((s) => s.edges);
  const params = useEditorStore((s) => s.params);
  const name = useEditorStore((s) => s.name);
  const index = useEditorStore((s) => s.index);
  // Recomputed on every edit so each chat turn sees the canvas as it is.
  const summary = React.useMemo(
    () => workflowSummary({ nodes, edges, params, name, index }),
    [nodes, edges, params, name, index, workflowSummary],
  );

  useAgentContext({
    description: "编辑器里当前打开的流程：节点、连线、流程参数和校验问题",
    value: summary as unknown as JsonSerializable,
  });

  useConfigureSuggestions({
    suggestions: [
      {
        title: "搭一个质控流程",
        message: "从样本表开始，搭一个 FastQC + fastp + MultiQC 的质控流程",
      },
      { title: "检查流程", message: "检查当前流程有什么问题，能修的直接修好" },
      { title: "解释这个流程", message: "用几句话解释当前流程每一步在做什么" },
      { title: "运行当前流程", message: "启动当前流程" },
    ],
  });

  useFrontendTool({
    name: moduleTool(canvasEditModule, "search_modules").name,
    description: moduleTool(canvasEditModule, "search_modules").description,
    parameters: z.object({
      query: z
        .string()
        .describe("工具名或用途，例如 fastqc、star align、trimming"),
      limit: z.number().int().min(1).max(20).optional(),
    }),
    handler: async ({ query, limit }) =>
      attempt(() => searchCatalog(query, limit)),
  });

  useFrontendTool(
    {
      name: moduleTool(canvasEditModule, "add_module").name,
      description: moduleTool(canvasEditModule, "add_module").description,
      parameters: z.object({
        moduleId: z
          .string()
          .describe("模块 id，例如 nf-core/fastqc 或 builtin/samplesheet"),
        after: z.string().optional().describe("放在这个节点（id 或别名）右边"),
        alias: z.string().optional().describe("自定义别名，大写字母和下划线"),
      }),
      handler: async (args) =>
        attempt(() => {
          const result = addModule(args);
          onCanvasChange();
          return result;
        }),
    },
    [onCanvasChange],
  );

  useFrontendTool({
    name: moduleTool(canvasEditModule, "connect_nodes").name,
    description: moduleTool(canvasEditModule, "connect_nodes").description,
    parameters: z.object({
      source: z.string().describe("上游节点 id 或别名"),
      sourcePort: z.string().optional(),
      target: z.string().describe("下游节点 id 或别名"),
      targetPort: z.string().optional(),
    }),
    handler: async (args) => attempt(() => connectNodes(args)),
  });

  useFrontendTool({
    name: moduleTool(canvasEditModule, "disconnect_nodes").name,
    description: moduleTool(canvasEditModule, "disconnect_nodes").description,
    parameters: z.object({ source: z.string(), target: z.string() }),
    handler: async (args) => attempt(() => disconnect(args)),
  });

  useFrontendTool({
    name: moduleTool(canvasEditModule, "remove_node").name,
    description: moduleTool(canvasEditModule, "remove_node").description,
    parameters: z.object({ node: z.string().describe("节点 id 或别名") }),
    handler: async ({ node }) => attempt(() => removeNode(node)),
  });

  useFrontendTool({
    name: moduleTool(canvasEditModule, "configure_node").name,
    description: moduleTool(canvasEditModule, "configure_node").description,
    parameters: z.object({
      node: z.string().describe("节点 id 或别名"),
      alias: z.string().optional(),
      widgets: z
        .record(z.string(), widgetValue)
        .optional()
        .describe("模块的值类输入，键是端口名"),
      config: z
        .object({
          args: z.string().optional().describe("ext.args，额外的命令行参数"),
          prefix: z.string().optional().describe("ext.prefix"),
          publish: z.boolean().optional().describe("是否把输出发布到 outdir"),
          label: z
            .string()
            .optional()
            .describe("资源标签，如 process_low、process_high"),
          errorStrategy: z.string().optional().describe("errorStrategy，例如 ignore"),
          when: z.string().optional().describe("when 指令的 Groovy 表达式"),
          whenEmpty: z.boolean().optional().describe("上游为空时才执行"),
          skip: z.boolean().optional().describe("用 params.skip_<别名> 跳过，并把输入 mix 给下游"),
          memory: z.string().optional().describe("memory 闭包体"),
          cpus: z.string().optional().describe("cpus 闭包体"),
          optionalOutputs: z.string().optional().describe("可选输出端口，逗号分隔"),
          publishPath: z.string().optional().describe("publishDir 路径表达式"),
          publishPattern: z.string().optional().describe("publishDir pattern glob"),
          publishSaveAs: z.string().optional().describe("saveAs 闭包体，例如 filename -> \"foo_$filename\""),
        })
        .optional(),
      disabled: z.boolean().optional(),
      referenceParam: z
        .string()
        .optional()
        .describe("参考文件节点对应的流程参数名，如 fasta、gtf"),
      referenceFormat: z
        .string()
        .optional()
        .describe("参考文件格式：fasta、gtf、fai、bed、vcf、index、other"),
    }),
    handler: async (args) => attempt(() => configureNode(args)),
  });

  useFrontendTool({
    name: moduleTool(canvasEditModule, "set_pipeline_param").name,
    description: moduleTool(canvasEditModule, "set_pipeline_param").description,
    parameters: z.object({ key: z.string(), value: widgetValue.nullable() }),
    handler: async ({ key, value }) => attempt(() => setParam(key, value)),
  });

  return null;
}

/** Canvas-edit module: read and edit the open workflow, then start it after confirmation. */
export function EditorAssistant({
  onCanvasChange,
}: {
  onCanvasChange: () => void;
}) {
  useAssistantModule(canvasEditModule.id);
  if (!useAssistantStatus().enabled) return null;
  return (
    <>
      <EditorTools onCanvasChange={onCanvasChange} />
      <StartRunTool />
    </>
  );
}
