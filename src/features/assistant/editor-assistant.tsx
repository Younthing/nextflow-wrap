"use client";

import * as React from "react";
import { useAgentContext, useConfigureSuggestions, useFrontendTool, type JsonSerializable } from "@copilotkit/react-core/v2";
import { z } from "zod";

import { useEditorStore } from "@/features/editor/store";
import { useAssistantStatus } from "./assistant-provider";
import { StartRunTool } from "./start-run-tool";
import {
  addModule,
  configureNode,
  connectNodes,
  disconnect,
  removeNode,
  searchCatalog,
  setParam,
  workflowSummary,
} from "./editor-actions";

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
  const nodes = useEditorStore((s) => s.nodes);
  const edges = useEditorStore((s) => s.edges);
  const params = useEditorStore((s) => s.params);
  const name = useEditorStore((s) => s.name);
  const index = useEditorStore((s) => s.index);
  // Recomputed on every edit so each chat turn sees the canvas as it is.
  const summary = React.useMemo(() => workflowSummary(), [nodes, edges, params, name, index]); // eslint-disable-line react-hooks/exhaustive-deps

  useAgentContext({ description: "编辑器里当前打开的流程：节点、连线、流程参数和校验问题", value: summary as unknown as JsonSerializable });

  useConfigureSuggestions({
    suggestions: [
      { title: "搭一个质控流程", message: "从样本表开始，搭一个 FastQC + fastp + MultiQC 的质控流程" },
      { title: "检查流程", message: "检查当前流程有什么问题，能修的直接修好" },
      { title: "解释这个流程", message: "用几句话解释当前流程每一步在做什么" },
      { title: "运行当前流程", message: "启动当前流程" },
    ],
  });

  useFrontendTool({
    name: "search_modules",
    description: "按关键词搜索模块库（nf-core 模块和内置输入节点），返回模块 id、说明和输入输出端口。",
    parameters: z.object({
      query: z.string().describe("工具名或用途，例如 fastqc、star align、trimming"),
      limit: z.number().int().min(1).max(20).optional(),
    }),
    handler: async ({ query, limit }) => attempt(() => searchCatalog(query, limit)),
  });

  useFrontendTool(
    {
      name: "add_module",
      description: "在画布上添加一个模块节点，返回节点 id、别名和端口。after 可以指定放在哪个节点右边。",
      parameters: z.object({
        moduleId: z.string().describe("模块 id，例如 nf-core/fastqc 或 builtin/samplesheet"),
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
    name: "connect_nodes",
    description: "把一个节点的输出端口连到另一个节点的输入端口。节点只有一个对应端口时可以省略端口名。",
    parameters: z.object({
      source: z.string().describe("上游节点 id 或别名"),
      sourcePort: z.string().optional(),
      target: z.string().describe("下游节点 id 或别名"),
      targetPort: z.string().optional(),
    }),
    handler: async (args) => attempt(() => connectNodes(args)),
  });

  useFrontendTool({
    name: "disconnect_nodes",
    description: "删除两个节点之间的所有连线。",
    parameters: z.object({ source: z.string(), target: z.string() }),
    handler: async (args) => attempt(() => disconnect(args)),
  });

  useFrontendTool({
    name: "remove_node",
    description: "删除一个节点和它的连线。",
    parameters: z.object({ node: z.string().describe("节点 id 或别名") }),
    handler: async ({ node }) => attempt(() => removeNode(node)),
  });

  useFrontendTool({
    name: "configure_node",
    description:
      "修改节点：别名、模块参数（widgets）、conf/modules.config 设置（ext.args、ext.prefix、是否发布结果、资源标签）、停用，以及参考文件节点的参数名和格式。只传要改的字段。",
    parameters: z.object({
      node: z.string().describe("节点 id 或别名"),
      alias: z.string().optional(),
      widgets: z.record(z.string(), widgetValue).optional().describe("模块的值类输入，键是端口名"),
      config: z
        .object({
          args: z.string().optional().describe("ext.args，额外的命令行参数"),
          prefix: z.string().optional().describe("ext.prefix"),
          publish: z.boolean().optional().describe("是否把输出发布到 outdir"),
          label: z.string().optional().describe("资源标签，如 process_low、process_high"),
        })
        .optional(),
      disabled: z.boolean().optional(),
      referenceParam: z.string().optional().describe("参考文件节点对应的流程参数名，如 fasta、gtf"),
      referenceFormat: z.string().optional().describe("参考文件格式：fasta、gtf、fai、bed、vcf、index、other"),
    }),
    handler: async (args) => attempt(() => configureNode(args)),
  });

  useFrontendTool({
    name: "set_pipeline_param",
    description: "设置流程参数（nextflow.config 里的 params），例如 input、outdir、fasta。value 传 null 删除参数。",
    parameters: z.object({ key: z.string(), value: widgetValue.nullable() }),
    handler: async ({ key, value }) => attempt(() => setParam(key, value)),
  });

  return null;
}

/** Lets the assistant read and edit the open workflow, and start it after a confirmation. */
export function EditorAssistant({ onCanvasChange }: { onCanvasChange: () => void }) {
  if (!useAssistantStatus().enabled) return null;
  return (
    <>
      <EditorTools onCanvasChange={onCanvasChange} />
      <StartRunTool />
    </>
  );
}
