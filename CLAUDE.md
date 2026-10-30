# CLAUDE.md

本文件为 Claude Code 在本仓库工作时提供指引。功能说明和 `/api` 接口表见 `README.md`，这里只写开发时需要知道的约定和结构。

@AGENTS.md

> Next.js 16 与训练数据中的版本差异很大：写路由、缓存、配置相关代码前，先查 `node_modules/next/dist/docs/` 里的对应文档。`AGENTS.md` 由 `next dev` 自动生成，不要手动删改。

## 常用命令

包管理器是 pnpm（版本锁定在 `package.json` 的 `packageManager`）。

```bash
pnpm install
pnpm dev                 # http://localhost:3000，Turbopack
pnpm storybook           # http://localhost:6006
pnpm test                # vitest run，只跑 src/**/*.test.ts，node 环境
pnpm vitest run src/features/workflow/ports.test.ts   # 跑单个测试文件
pnpm vitest run -t "关键字"                            # 按用例名过滤
pnpm typecheck           # next typegen && tsc --noEmit
pnpm lint                # eslint（next core-web-vitals + typescript）
pnpm build
pnpm build-storybook
pnpm sync:modules        # 从 nf-core/modules 重新生成 src/data/nf-core-modules.json（需要网络）
```

CI（`.github/workflows/ci.yml`）依次跑 `typecheck`、`lint`、`test`、`build`、`build-storybook`，提交前本地按这个顺序跑一遍。

## 架构

技术栈：Next.js 16 App Router + TypeScript、Tailwind CSS 4（玻璃拟态）、shadcn/ui 写法（Radix + cva）、lucide-react、TanStack Query / Table、React Flow（`@xyflow/react`）、zustand、zod、Tiptap、CopilotKit v2、MSW、Storybook 10。

### 目录

- `src/app`：路由。`/` 是流程编辑器，`/runs` 和 `/runs/[id]` 是运行记录；`api/copilotkit` 是唯一的真实服务端路由。`fonts.ts` 用 next/font 加载思源黑体、思源宋体、JetBrains Mono；`globals.css` 定义主题变量和 `glass` / `glass-strong` / `ambient-backdrop` 工具类。
- `src/components/ui`：基础组件，shadcn/ui 写法（`radix-ui` 统一包 + `cva` + `cn`），带 `glass` 变体。新增组件沿用同样的写法，并在 `ui/stories` 加 story。
- `src/components/layout`：应用外壳、导航栏、主题切换、后端状态。
- `src/components/providers.tsx`：QueryClient、Tooltip、`MockingGate`（等 MSW worker 启动后再渲染）和 AI 助手 Provider。
- `src/features/<领域>`：按领域划分，每个领域自带 `components/`、`stories/`、`queries.ts`（TanStack Query hooks）和纯逻辑模块及其测试：
  - `workflow`：流程文档模型（`types.ts`、`document.ts`）、模块目录（`catalog.ts`）、端口兼容性（`ports.ts`）、校验（`validate.ts`）、内置节点（`builtins.ts`）、示例流程（`demo.ts`）。
  - `editor`：React Flow 画布、模块库、检查器面板。状态在 zustand `store.ts`（节点、连线、参数、撤销/重做历史、保存版本号）。
  - `project`：把画布生成 nf-core 模板结构的项目（`generate.ts`、`workflow-script.ts`、`templates.ts`、`schema.ts`），以及启动配置和 `run.config`（`launch.ts`）。
  - `runs`：运行相关类型（`types.ts`、`outputs.ts`）、轮询查询（`queries.ts`，运行中才 `refetchInterval`）、模拟器（`simulate.ts`）。
  - `assistant`：CopilotKit 前端工具（`editor-actions.ts`）、编辑器/运行页助手、系统提示词 `prompt.ts`。
- `src/lib`：`api.ts`（`/api` 的 fetch 封装，抛 `ApiError`）、`mocking.ts`、`theme.ts`、`utils.ts`（`cn`）。
- `src/mocks`：MSW 模拟后端。`handlers.ts` 处理流程和模块目录，`runs.ts` 处理运行，`db.ts` 把数据存在 localStorage（键 `nf-studio-mock-db`）。
- `src/data`：提交进仓库的生成数据（`nf-core-modules.json` 由 `scripts/sync-nf-core-modules.mjs` 生成，不要手改）。

### 数据流

- 目前没有真实后端。除 `/api/copilotkit` 外，所有 `/api` 请求都由浏览器里的 MSW 应答；`NEXT_PUBLIC_API_MOCKING=disabled` 关闭模拟。改接口时要同时改 `src/features/*/types.ts` 的类型、对应的 `queries.ts` 和 `src/mocks` 里的 handler，并更新 README 的接口表。
- 组件只通过 `features/*/queries.ts` 里的 hooks 取数，不直接调用 `fetch`。
- 运行模拟是确定性的：`simulate.ts` 按流程结构和时间推演任务进度，参数 `simulate_failure: true` 模拟失败。保持确定性，测试依赖它。

### 流程编辑器与项目生成

- 模块定义来自 nf-core `meta.yml` 和 `main.nf`。端口由元组元素（`meta` / `file` / `value`）组成，连线兼容性在 `ports.ts` 的 `checkCompatibility` 里判断（补齐可选文件、去掉 meta、格式不一致警告、`collect` 输入多连）。
- 生成的项目跟随最新 nf-core 模板（Nextflow `>=25.10.4`、nf-schema 2.7.3、topic channel 版本信息）。nf-core 模块不内嵌，按 `modules.json` 锁定的提交由后端安装。改生成逻辑时同步更新 `generate.test.ts`。

### AI 助手

`/api/copilotkit` 在服务端调用模型（`COPILOT_MODEL`，默认 `anthropic/claude-sonnet-5-5`，key 放 `.env.local`）。工具都在浏览器注册和执行，改画布要走 editor store 的 action，这样每一步都能撤销。没有 key 时助手按钮禁用，其他功能不受影响。

## 约定

- 界面文案、README 和本文件用中文；代码标识符、代码注释和提交信息用英文。
- 导入路径用 `@/` 别名指向 `src/`。
- 需要浏览器状态或 hooks 的文件加 `"use client"`；`next.config.ts` 开了 `cacheComponents` 和 `partialPrefetching`。
- 颜色用 `globals.css` 里的主题变量（支持 `.dark`），玻璃效果用 `glass` 类，不要硬编码颜色。
- 纯逻辑（端口、校验、生成、模拟、文档解析）放在不依赖 React 的模块里并写 vitest 测试；UI 组件写 Storybook story（`.storybook/preview.tsx` 提供主题切换和字体）。
