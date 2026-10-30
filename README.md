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

## 开发

```bash
pnpm install
pnpm dev               # http://localhost:3000
pnpm storybook         # http://localhost:6006
pnpm typecheck && pnpm lint && pnpm build
```

目前还没有真实后端，所有 `/api` 请求都由 MSW（`src/mocks`）在浏览器里应答。接入真实后端后，设置 `NEXT_PUBLIC_API_MOCKING=disabled` 即可关闭模拟。
