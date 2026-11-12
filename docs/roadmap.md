# 接下来的计划

更新日期：2026-11-11，对应桌面版 0.2.1（`desktop-v0.2.1`，#80 合入之后）。

## 现在在哪里

产品的主线已经闭环：在项目文件夹里写笔记本 → 标出输入输出并试跑 → 发布为不可变的模块版本 → 在画布上连成流程 → 生成不依赖插件的标准 Nextflow 项目 → 在本机、SSH 集群或云执行器上运行 → 实时看任务、日志和结果，能取消、能从明确来源续跑。

| 方面 | 现状 | 主要代码 |
| --- | --- | --- |
| 项目工作台 | 打开文件夹，笔记本、流程画布、文本文件共用标签页；文件是权威，`.studio/state.sqlite` 是可重建的索引；保存冲突有比较/重载/另存/覆盖 | `src/features/workspace`、`src/features/workbench`、`src/app/workbench` |
| 笔记本 | Python / R 常驻 Jupyter 内核，内核从项目根目录启动；试跑后发布模块；共享模块库 | `src/features/notebook` |
| 画布与生成 | React Flow 画布，端口类型校验，撤销/重做；生成 `main.nf`、模块目录、`nextflow_schema.json` 等 | `src/features/editor`、`src/features/workflow`、`src/features/project` |
| 执行 | 独立 runner 排队（本机 1 槽、远程默认 4 槽），nf-weblog 实时事件 + trace 对账，runner 重启后接管 | `scripts/runner.ts`、`src/features/runs/server` |
| 集群 | SSH 登录节点启动 Nextflow；项目数据同步到 `projects/`，每次运行读硬链接快照 | `src/features/remote` |
| 交付 | Electron 桌面版（本机 / WSL / SSH / 地址四种后端），独立 Linux 服务端包，四平台 CI 打包发布 | `desktop/`、`scripts/build-server.mjs`、`.github/workflows/desktop.yml` |
| AI 助手 | CopilotKit 侧栏，后端按 Codex CLI → Grok Build CLI → API key 选择；改画布的工具可撤销，改运行的工具需确认 | `src/features/assistant` |

## P0：马上处理

1. **项目注册表的迁移策略。** `workspace-registry.sqlite` 没有迁移，格式一变桌面版就删掉重建（最近项目、运行环境状态、共享模块库都会丢）。共享模块库是用户数据，至少要在重建前导出到文件，或者把共享库挪成一个普通文件夹。

## P1：下一个版本（0.3）

1. **桌面版原生验收。** 打包 E2E 只在 Linux 上跑；Windows（WSL 后端）和 macOS 的安装、首次启动、自动更新还没有自动化覆盖（见 [desktop-release.md](desktop-release.md)）。先补 macOS 打包启动冒烟，再补 Windows 连接 WSL 的冒烟。
2. **签名与供应链。** 配置正式签名证书；Actions 固定到 commit SHA，加构建来源证明；保护 `desktop-v*` 标签。
3. **集群体验。** 结果超过 `NEXTFLOW_STUDIO_REMOTE_FETCH_MAX_MB` 时留在集群上，结果页只给路径：加按需取回单个文件。通配路径目前拒绝同步，可以考虑在提交时展开为文件列表。
4. **磁盘清理覆盖项目内运行。** 设置 → 磁盘 按 Nextflow 会话清理；确认它也能看到每个项目 `.studio/runtime/work/` 和 `runs/*/results/` 的占用，并在项目被移动后给出提示。
5. **可访问性。** Storybook 测试关掉了 `color-contrast` 规则（主按钮文字约 4.2:1）。在液态玻璃配色里调整到 4.5:1 后重新打开这条规则。

## P2：之后

- 多用户与鉴权：目前是单用户可信流程，服务端只有会话令牌；面向实验室共享服务器前需要用户、权限和隔离。
- 模块生态：共享库目前在注册表数据库里，可以改为团队 Git 仓库或对象存储，支持版本对比和废弃标记。
- 结果联动：结果文件已能追溯到节点、模块版本和笔记本修订，可以做「从结果回到笔记本继续分析」的完整链路。
- 更多示例课程：在单细胞、分子对接、免疫荧光之外增加一个测序质控类示例。

## 文档约定

- 功能和接口以 [README](../README.md) 为准；项目文件夹模型以 [project-workbench.md](project-workbench.md) 为准；面向用户的说明在 [user-guide/](user-guide/README.md)。
- [archive/](archive/) 里是第一版真实执行的计划和验收记录，描述的代码（nf-core 模块、全局 `studio.sqlite`、`pnpm smoke:nextflow`）已不存在，只作历史参考。
- 改行为的 PR 同时改对应文档；完成上面某一项后，在这里把它删掉或移到「现在在哪里」。
