# 本机真实执行：实现与验收

日期：2026-10-31。

## 已实现

- Next.js 业务 API：健康检查、模块目录、样本 schema、工作流 CRUD、运行提交/查询/取消/恢复/删除、任务、日志、结果预览及下载。
- SQLite 持久化工作流、运行快照、事件、任务尝试和 runner 租约；事务领取任务，首次提交支持幂等键。删除运行仅隐藏记录，保留缓存与计算文件。
- 独立 TypeScript runner：本机 Docker、逐次隔离目录、依赖安装和 SHA/文件校验和记录、原始日志、每次运行独立容器标签、取消和孤儿任务清理。
- nf-weblog 实时事件与 raw trace 最终对账；任务使用 task ID + attempt，处理重复和乱序事件，保留重试历史。
- 明确来源的 `-resume <session-id>`，复用原项目、cache 和 work，日志和结果按尝试保存。
- 网页能力限制、准备/取消/中断状态、任务诊断、真实文件下载、去脚本的沙箱静态报告预览。
- 微型单/双端合成数据、可重复的 CLI 和 API smoke 命令；测试数据无需下载公共测序数据。

## 环境

- Node.js 22.23.2，Nextflow 26.10.4，nf-core/tools 4.2.1。
- 运行进程使用已有 Java 25.0.5，未修改用户全局 Java 配置。
- Docker 29.9.2，aarch64，10 CPU / 约 8 GB；质控镜像通过 amd64 模拟执行。
- 模块目录 SHA：`8bc51f2971a284eba5629c9e7c53474933a339aa`。
- `nf-schema@2.7.3`、`nf-weblog@1.2.0`。`utils_nfschema_plugin` 单独固定到 `a7b27fd25bfa8dcc07d299e88bd790585901a436`，避免 2.x/3.x API 混用；启动覆盖配置显式保留两个插件。

## 实际执行证据

1. `pnpm smoke:nextflow`：本机 hello、容器 hello、两个 FastQC 任务和一个 MultiQC 任务成功。三份 FastQC HTML/ZIP 已发布，MultiQC 的三个读段文件均报告 200 条序列。
   - 目录：`~/.local/share/nextflow-studio/smoke/2026-10-30T17-40-49-063Z/`。
2. `pnpm smoke:nextflow --star`：fastp ×2、FastQC ×2、STAR 建索引 ×1、STAR 比对 ×2、MultiQC ×1，共 8 个任务成功。使用微型合成参考序列；这是执行兼容性验收，不用于生物学结论。
   - 目录：`~/.local/share/nextflow-studio/smoke/2026-10-30T17-53-12-227Z/`，`verification.json` 已核验。
3. `pnpm smoke:runner`：并发相同幂等键仅创建一个运行；观测到运行中任务；3 个任务成功、结果可下载、越界结果路径返回 403；从明确来源恢复，两个 FastQC 任务均为 CACHED；运行中取消成功；缺失输入形成可查询失败记录。
   - 成功：`65deabff-6768-4ed5-b4a1-6ad42f9af474`。
   - 缓存恢复：`f758442a-2570-46c9-9c7f-2214238fc1b7`。
   - 取消：`e0e25c68-601c-4ecc-9cda-5f96c42abd6e`。
   - 缺失输入失败：`bbc5458f-b7ad-4dbf-9434-241ca27c321b`。
4. 浏览器从画布点击「运行 → 启动运行」，进入真实详情、查看 3 个任务及 `.command.log`，下载 MultiQC，刷新后状态仍为成功。
   - 网页提交：`a7a02d8e-a6a7-4887-bde0-2ab5cbe0984c`。
5. 强制结束本次启动的 runner：原运行 `18561279-2d4a-4a0a-98c7-2ce3e350984b` 在重启后标记 interrupted，活动任务终止且无该标签的遗留容器；从原记录恢复为 `2d46e060-3d78-4ea0-b459-060de35bd189`，最终成功。
6. 在真实计算中结束本次启动的 web 进程，runner 继续执行；启动生产 web 后查询 `e1ed3a3f-8c37-4a65-8b79-6c4b7801961a` 为成功，两个 FastQC 命中缓存。
7. 生产页面浏览器验证：1600×1000 Chromium；页面身份正确，任务表 3 行、任务日志与结果可读，MultiQC 下载 2,374,707 字节，刷新保留成功状态；没有页面异常或 console error。Browser 插件不可用，使用 Playwright。截图保存在 `/tmp/nextflow-production-tasks.png` 与 `/tmp/nextflow-production-results.png`，未提交截图或临时浏览器脚本。

## 自动化检查

- TypeScript、ESLint、Vitest：通过，14 个测试文件、58 项测试。
- 真实模式 Next.js 生产构建：通过，API 为动态 Node 路由。
- Storybook 生产构建：通过。依赖有现存的 `use client` bundling 提示，不影响构建。
- 单元测试覆盖项目落盘边界、进程退出/超时/日志、数据库持久化和事务、事件去重/乱序/重试，以及 Next.js URL 规范化后的同源校验。

## 使用与边界

先启动 `pnpm runner`，另一个终端启动 `pnpm dev:real`；生产使用 `pnpm build:real` 和 `pnpm start`。入口为 `http://127.0.0.1:3000`。

本版服务本机单用户可信流程，只支持 local + Docker。输入样本表使用 runner 主机的绝对路径；输出/work 自动隔离，远程机构配置默认不加载。HTML 只提供静态预览，下载后可使用报告的交互功能。Node 22 的内置 SQLite 仍会显示实验性 API 提示。

远程执行器、多用户认证、大文件上传、磁盘清理界面和移动端工作台优化尚未纳入第一版。不能把本机 runner 当成不可信代码沙箱，也不应直接暴露到公网。保留 `.nextflow/cache` 和 `work` 才能恢复；删除记录不会清理磁盘。
