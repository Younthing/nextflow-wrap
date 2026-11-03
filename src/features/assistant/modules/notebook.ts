import type { AssistantModule } from "./contract";

export const RUN_NOTEBOOK_CELL_DESCRIPTION =
  "运行笔记本里的一个代码单元格并返回输出（stdout、stderr、报错，过长会截断）。调用后会弹出确认对话框，只有用户接受才会执行。草稿有未保存的改动时先保存再运行。说明单元格不能运行。你必须等这个工具返回后再说已经运行。";

const prompt = `## 笔记本
- 用户正在编辑脚本笔记本。单元格类型（kind）有 code（代码）、markdown（说明）、input（输入）、output（输出）、explore（探索，发布时去掉）。也可以在代码里用 \`# @input\` / \`# @output\` 标出端口；标了输入或输出之后，这本才准备进入后续步骤。
- 上下文里有笔记本摘要。需要准确的单元格 id、完整内容或输出时，先用 get_notebook_summary 和 read_cell_output，不要凭记忆改。
- 修改笔记本要调用 edit_notebook_cell，不要只描述步骤：insert 在 cellId 之后插入（TOP / BOTTOM 表示开头 / 末尾），edit 改 source 或 kind，delete 删除。source 要写完整的单元格内容，保留缩进，不要写省略标记。一次改多格按顺序逐个调用。不要删除用户没提到的单元格。
- 改完代码要验证时用 run_notebook_cell。它会先弹出确认对话框，调用后必须停下来等工具返回；返回 declined 表示用户没有确认，不要立刻重试。Python 笔记本跑在常驻内核里，只运行这一格，变量会保留；R 笔记本每次从第一格跑到这一格。
- 运行出错时读返回的 error 和 stderr，修好单元格再运行。看已经跑过的输出用 read_cell_output。
- 切换内核、试跑和发布仍在页面上操作，不要声称已经做过。`;

/** Notebook editing, shaped like VS Code's notebook tools. Tools live on the notebook editor surface. */
export const notebookModule = {
  id: "notebook",
  title: "笔记本",
  prompt,
  tools: [
    {
      name: "get_notebook_summary",
      description: "列出当前笔记本的单元格：序号、id、类型（kind）、行数、内容预览，以及是否有输出、是否报错。编辑或运行前先用它拿单元格 id。",
    },
    {
      name: "edit_notebook_cell",
      description:
        "编辑当前笔记本的一个单元格。editType=insert 在 cellId 之后插入新单元格（cellId 用 TOP / BOTTOM 表示开头 / 末尾）；edit 改 cellId 的 source 或 kind；delete 删除 cellId。改动立即出现在编辑器里并自动保存。",
    },
    { name: "run_notebook_cell", description: RUN_NOTEBOOK_CELL_DESCRIPTION },
    {
      name: "read_cell_output",
      description: "读取一个单元格当前显示的输出：stdout、stderr、报错和文本结果（过长会截断）。",
    },
  ],
} as const satisfies AssistantModule;
