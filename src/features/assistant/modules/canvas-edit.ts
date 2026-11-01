import { EDITOR_ACTIONS } from "@/features/editor/commands";
import { shortcutHint } from "@/lib/actions";

import type { AssistantModule } from "./contract";

export const START_RUN_DESCRIPTION =
  "启动编辑器里当前已保存的流程。调用后会弹出确认对话框，只有用户接受才会提交运行；拒绝、关闭或中断都不会启动。使用运行对话框里保存的执行器、profile 和工作目录。你必须等这个工具返回后再说运行已启动。";

const prompt = `## 搭建流程
- 画布上每个节点是一个从笔记本发布的模块（moduleId 形如 script/scanpy_qc/v1）或内置节点，例如输入节点：builtin/samplesheet（样本表，输出每个样本的 [meta, reads]）、builtin/reference（参考文件，把 --fasta 这类参数变成通道，有 with_meta 和 file 两个输出）。
- 端口携带的是通道元组，例如 "meta, h5ad" 或 "meta, sdf"。连线前确认上下游的元组形状和文件格式对得上；不确定的模块先用 search_modules 查端口。
- 流程从输入节点开始：每样本一行的数据用样本表节点，单个数据文件（如 h5ad、受体结构）用参考文件节点。
- 修改画布要调用工具，不要只描述步骤。一次改动多个节点时按顺序逐个调用；工具报错时读错误信息并修正后重试。
- 改完后看 workflow 上下文里的 issues，有 error 要继续修，或者告诉用户还缺什么（比如 --input 样本表路径）。
- 每个改动都能用 ${shortcutHint(EDITOR_ACTIONS.undo.shortcut)} 撤销，可以放心操作，但不要删除用户没提到的节点。

## 启动当前流程
- 编辑器页面有 start_run，用来启动当前流程。它使用运行对话框里保存的环境设置，不要另编执行器或命令。
- 调用 start_run 后必须停下来等工具返回。工具会先弹出确认对话框，用户点确认之前不会启动。取消、关闭对话框或中断都不会执行。不要在返回前说已经启动。
- 返回 blocked 和 problems 时说明原因；能在画布上修好的先修好，再问要不要重新启动。`;

/** Canvas editing and starting the open workflow. Tools live in the editor surface. */
export const canvasEditModule = {
  id: "canvas-edit",
  title: "画布编辑",
  defaultActive: true,
  prompt,
  tools: [
    {
      name: "search_modules",
      description: "按关键词搜索模块库（已发布模块和内置节点），返回模块 id、说明和输入输出端口。",
    },
    {
      name: "add_module",
      description: "在画布上添加一个模块节点，返回节点 id、别名和端口。after 可以指定放在哪个节点右边。",
    },
    {
      name: "connect_nodes",
      description: "把一个节点的输出端口连到另一个节点的输入端口。节点只有一个对应端口时可以省略端口名。",
    },
    {
      name: "disconnect_nodes",
      description: "删除两个节点之间的所有连线。",
    },
    {
      name: "remove_node",
      description: "删除一个节点和它的连线。",
    },
    {
      name: "configure_node",
      description:
        "修改节点：别名、模块参数（widgets）、conf/modules.config 设置（ext.args、ext.prefix、是否发布结果、资源标签）、停用，以及参考文件节点的参数名和格式。只传要改的字段。",
    },
    {
      name: "set_pipeline_param",
      description: "设置流程参数（nextflow.config 里的 params），例如 input、outdir、fasta。value 传 null 删除参数。",
    },
    { name: "start_run", description: START_RUN_DESCRIPTION },
  ],
} as const satisfies AssistantModule;
