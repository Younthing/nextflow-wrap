# Nextflow Studio (nextflow-wrap)

ComfyUI 式的 Nextflow 可视化前端：在画布上用 nf-core 模块搭建流程，一键运行，实时追踪任务并查看结果。生成的项目遵循 nf-core 模板结构，可直接用 `nextflow run` 运行。

## 技术栈

- Next.js 16（App Router，Turbopack）+ TypeScript
- Tailwind CSS 4，玻璃拟态主题（`src/app/globals.css` 中的 `glass` / `glass-strong` / `ambient-backdrop` 工具类）
- shadcn/ui 写法的基础组件（Radix + cva），见 `src/components/ui`
- lucide-react 图标；next/font 加载思源黑体、思源宋体、JetBrains Mono
- TanStack Query 取数，MSW 在浏览器里模拟 `/api`
- Storybook 10（`@storybook/nextjs-vite`）
- React Flow 画布，TanStack Table 表格，Tiptap 编辑器

## 流程编辑器

- 模块库来自 nf-core/modules 的 `meta.yml` 和 `main.nf`（`pnpm sync:modules` 重新同步，结果提交在 `src/data/nf-core-modules.json`）。
- 端口按通道元素类型着色：文件、值、meta、目录。连线时校验元组结构，必要时自动补齐可选文件（`[]`）或去掉 meta；文件格式不一致会给出提醒并画成虚线。
- MultiQC 这类收集输入可以连接多个输出，会自动 `mix` 并 `collect`。
- 只接受值的输入（布尔、字符串、数字）直接显示为节点上的控件。
- 双击画布搜索模块；把连线拖到空白处会搜索能接上的模块并自动连线。
- 右侧面板编辑节点配置（`ext.args`、`ext.prefix`、资源标签、是否发布）或流程参数（按 `nextflow_schema.json` 自动生成）。
- 撤销/重做（Ctrl+Z / Ctrl+Shift+Z），Ctrl+S 保存，已保存的流程会自动保存；也可以导入/导出 JSON。

## 开发

```bash
pnpm install
pnpm dev               # http://localhost:3000
pnpm storybook         # http://localhost:6006
pnpm test              # 端口兼容性、校验等单元测试
pnpm typecheck && pnpm lint && pnpm build
```

目前还没有真实后端，所有 `/api` 请求都由 MSW（`src/mocks`）在浏览器里应答。接入真实后端后，设置 `NEXT_PUBLIC_API_MOCKING=disabled` 即可关闭模拟。
