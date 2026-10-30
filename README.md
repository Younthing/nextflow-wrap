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
- CopilotKit v2 AI 助手（`@copilotkit/react-core/v2` + `@copilotkit/runtime/v2`）

## 流程编辑器

- 模块库来自 nf-core/modules 的 `meta.yml` 和 `main.nf`（`pnpm sync:modules` 重新同步，结果提交在 `src/data/nf-core-modules.json`）。
- 端口按通道元素类型着色：文件、值、meta、目录。连线时校验元组结构，必要时自动补齐可选文件（`[]`）或去掉 meta；文件格式不一致会给出提醒并画成虚线。
- MultiQC 这类收集输入可以连接多个输出，会自动 `mix` 并 `collect`。
- 只接受值的输入（布尔、字符串、数字）直接显示为节点上的控件。
- 双击画布搜索模块；把连线拖到空白处会搜索能接上的模块并自动连线。
- 右侧面板编辑节点配置（`ext.args`、`ext.prefix`、资源标签、是否发布）或流程参数（按 `nextflow_schema.json` 自动生成）。
- 撤销/重做（Ctrl+Z / Ctrl+Shift+Z），Ctrl+S 保存，已保存的流程会自动保存；也可以导入/导出 JSON。

## 一键运行

点工具栏的「运行」会把画布生成一个 nf-core 结构的项目（`src/features/project`），并选择运行环境后提交到后端：

- 生成的文件：`main.nf`、`workflows/<name>.nf`、`subworkflows/local/utils_nfcore_<name>_pipeline`、`nextflow.config`、`conf/{base,modules,test}.config`、`nextflow_schema.json`、`assets/*`、`modules.json`、`.nf-core.yml`、`README.md`。nf-core 模块和 `utils_*` 子流程不内嵌，按 `modules.json` 里锁定的提交由后端 `nf-core modules install` 安装。
- 跟随最新 nf-core 模板：Nextflow `>=25.10.4`，nf-schema 2.7.3，版本信息走 topic channel，MultiQC 用新的元组输入。
- 运行环境：本机、SLURM、Google Batch、AWS Batch、Azure Batch、Kubernetes。执行器设置写进单独的 `run.config`，容器/环境用 `-profile`，参数写进 `params.json`，后端在项目目录里执行：

  ```bash
  nextflow run . -profile docker -c run.config -params-file params.json -resume
  ```

- 运行记录页（`/runs`）和详情页（`/runs/<id>`）显示状态、进度、命令、配置和当时的项目快照，运行中可以停止。

### `/api/runs` 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/runs?workflowId=` | 运行列表（`RunSummary[]`） |
| `POST` | `/api/runs` | 启动：`LaunchRequest`（流程、项目文件、参数、启动配置、`run.config`、命令） |
| `GET` | `/api/runs/:id` | 运行详情（`RunDetail`） |
| `POST` | `/api/runs/:id/cancel` | 停止，已结束返回 409 |
| `DELETE` | `/api/runs/:id` | 删除记录 |

运行详情页可以实时查看：

- **流程图**：画布上的每个节点显示任务进度（完成、运行中、失败），点节点跳到它的任务。
- **任务**：每个任务的状态、耗时、CPU、峰值内存和退出码（和 Nextflow trace 的字段一致），点开看 `.command.log`。
- **日志**：`nextflow run -ansi-log false` 风格的控制台输出，出错时显示失败的进程和工作目录。
- **结果**：`--outdir` 下按模块分组的文件，MultiQC 报告和文本文件可以直接预览（HTML 报告放在无脚本的沙箱 iframe 里）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/runs/:id/tasks` | 任务列表（`TaskRecord[]`） |
| `GET` | `/api/runs/:id/log` | 控制台日志 `{ lines }` |
| `GET` | `/api/runs/:id/task-log?hash=` | 单个任务的 `.command.log` `{ text }` |
| `GET` | `/api/runs/:id/results` | outdir 下的文件（`ResultFile[]`） |
| `GET` | `/api/runs/:id/results/content?path=` | 文件内容，按 `content-type` 返回 |

类型定义在 `src/features/runs/types.ts` 和 `src/features/runs/outputs.ts`。模拟后端（`src/mocks/runs.ts`）按流程结构确定性地推演任务进度；参数里设置 `simulate_failure: true` 可以模拟任务失败。

## AI 助手

顶栏的「AI 助手」打开 CopilotKit 侧边栏。模型在 Next.js 的 `/api/copilotkit` 路由里调用，API key 只在服务端；助手能用的工具在浏览器里注册和执行，所以它改画布和手动编辑一样，每一步都能撤销。

- **编辑器**：助手能看到当前流程（节点、端口、连线、参数和校验问题），可以搜索模块、添加节点、连线和断开、删除节点，修改别名、模块参数、`ext.args`/`ext.prefix`/资源标签/是否发布，以及设置流程参数。工具出错时会把原因返回给模型，模型据此修正后重试。
- **运行详情页**：助手能看到这次运行的状态、参数、命令和失败任务，可以读取任务的 `.command.log` 和 Nextflow 主日志来解释失败原因。它不能启动或停止运行。

在 `.env.local` 里配置模型：

```bash
ANTHROPIC_API_KEY=sk-ant-...
# 可选，默认 anthropic/claude-sonnet-5-5；也支持 openai/<model>（OPENAI_API_KEY）和 google/<model>（GOOGLE_API_KEY）
COPILOT_MODEL=anthropic/claude-sonnet-5-5
```

没有配置 key 时，按钮会变灰并提示缺少哪个变量，应用的其他功能不受影响。代码在 `src/features/assistant`，系统提示词在 `src/features/assistant/prompt.ts`。

## 开发

```bash
pnpm install
pnpm dev               # http://localhost:3000
pnpm storybook         # http://localhost:6006
pnpm test              # 端口兼容性、校验、项目生成、运行模拟等单元测试
pnpm typecheck && pnpm lint && pnpm build
```

目前还没有真实后端，除 `/api/copilotkit` 外的 `/api` 请求都由 MSW（`src/mocks`）在浏览器里应答。接入真实后端后，设置 `NEXT_PUBLIC_API_MOCKING=disabled` 即可关闭模拟。
