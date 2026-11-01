# Nextflow Studio (nextflow-wrap)

ComfyUI 式的 Nextflow 可视化前端：在笔记本里写分析脚本并发布成模块，在画布上用这些模块和内置节点搭建流程，一键运行，实时追踪任务并查看结果。生成的是不依赖插件的标准 Nextflow 项目，可直接用 `nextflow run` 运行。

## 技术栈

- Next.js 16（App Router，Turbopack）+ TypeScript
- Tailwind CSS 4，玻璃拟态主题（`src/app/globals.css` 中的 `glass` / `glass-strong` / `ambient-backdrop` 工具类）
- shadcn/ui 写法的基础组件（Radix + cva），见 `src/components/ui`
- lucide-react 图标；next/font 加载思源黑体、思源宋体、JetBrains Mono
- TanStack Query 取数；本机 API + SQLite 持久化 + 独立 Nextflow runner，另保留 MSW 演示模式
- Storybook 10（`@storybook/nextjs-vite`）
- React Flow 画布，TanStack Table 表格
- CopilotKit v2 AI 助手（`@copilotkit/react-core/v2` + `@copilotkit/runtime/v2`）

## 流程编辑器

- 模块库只有两类：笔记本发布、试跑通过的自定义模块，和随产品提供的内置节点（输入、通道算子、功能节点）。测试、Storybook 和演示模式共用 `src/features/workflow/example-modules.ts` 里的单细胞和分子对接示例模块。
- 端口按通道元素类型着色：文件、值、meta、目录。连线时校验元组结构，必要时自动补齐可选文件（`[]`）或去掉 meta；文件格式不一致会给出提醒并画成虚线。
- 汇总报告这类收集输入可以连接多个输出，会自动 `mix` 并 `collect`。
- 只接受值的输入（布尔、字符串、数字）直接显示为节点上的控件。
- 双击画布搜索模块；把连线拖到空白处会搜索能接上的模块并自动连线。
- 右侧面板编辑节点配置（`ext.args`、`ext.prefix`、资源标签、是否发布）或流程参数（按 `nextflow_schema.json` 自动生成）。
- 撤销/重做（Ctrl+Z / ⌘Z，重做 Ctrl+Shift+Z / ⇧⌘Z，也可 Ctrl+Y / ⌘Y），Ctrl+S / ⌘S 保存，已保存的流程会自动保存；也可以导入/导出 JSON。
- 复制、粘贴、创建副本（Ctrl+C / ⌘C、Ctrl+V / ⌘V、Ctrl+D / ⌘D）。Delete 或 Backspace 删除选中的节点和连线，撤销可恢复。粘贴只保留选区内部的连线。Ctrl+A / ⌘A 全选，Esc 取消选择。Ctrl+K / ⌘K 或 / 打开节点搜索，F 或 Shift+1 / ⇧1 适应视图（有选中节点时对准选区）。

## 笔记本

- Python 笔记本的单元格在常驻 Jupyter 内核里运行，每本笔记本一个内核，变量和工作目录（`<数据目录>/scratch/notebooks/<笔记本 id>/`）里的文件在多次运行之间保留。运行单个单元格只跑这一格；「运行全部」先重启内核，再从第一格依次运行，遇到报错停下。工具栏显示内核状态，可以中断正在跑的单元格或重启内核。
- 内核选择器列出本机已安装的 Jupyter kernelspec（如 `python -m ipykernel install --user --name scanpy` 注册的环境）。笔记本记的内核名不是已安装的 kernelspec 时改用 `python3`，并在工具栏下方说明。
- 需要 `python3 -m pip install ipykernel`（`NEXTFLOW_STUDIO_JUPYTER_PYTHON` 可换解释器）。没有 Jupyter 时退回旧行为：每次在新进程里从头运行到所选单元格。内核空闲 2 小时后自动关闭（`NEXTFLOW_STUDIO_KERNEL_IDLE_MS`）。R 笔记本本期只编辑，试跑时调用 `Rscript`。

| 方法   | 路径                         | 说明                                                              |
| ------ | ---------------------------- | ----------------------------------------------------------------- |
| `POST` | `/api/notebooks/:id/run`     | 运行单元格：`{ cellId? }`，返回 `{ cells, kernel }`               |
| `GET`  | `/api/notebooks/:id/kernel`  | 内核状态：`stopped`、`starting`、`idle`、`busy`、`dead`           |
| `POST` | `/api/notebooks/:id/kernel`  | `{ action: "interrupt" \| "restart" \| "shutdown" }`               |
| `GET`  | `/api/kernels`               | 本机 Jupyter kernelspec 列表                                      |

## 一键运行

点工具栏的「运行」会把画布生成一个标准 Nextflow 项目（`src/features/project`），并选择运行环境后提交到后端：

- 生成的文件：`main.nf`（入口 workflow）、`modules/<namespace>/<name>/`（每个发布模块一个自包含目录：`main.nf` 里的 process 写着 conda / container 依据，另有 `meta.yml`、可选的 `environment.yml` 和 `resources/usr/bin/<脚本>`；本机和 HPC 执行器靠 `nextflow.enable.moduleBinaries` 把它放上 PATH，云批处理和 k8s 改放项目 `bin/`）、`nextflow.config`（参数和全部运行时 profile）、`conf/{base,modules}.config`、`nextflow_schema.json`、`README.md`；用到样本表时另有 `assets/schema_input.json` 和示例 `assets/samplesheet.csv`。不需要 nf-core/tools、Git 或任何插件，离线也能生成。
- 样本表用 `splitCsv` 读入并按 sample 合并多行，参数在应用里按 schema 校验。
- 真实模式按 Nextflow 自己的语义运行：模块里写的 conda / container 只是依据，实际用哪个由 `-profile` 决定。可选本机 shell（默认，不加 profile）以及 conda、mamba、micromamba、docker、podman、singularity、apptainer、charliecloud、shifter、sarus、spack、wave；执行器可选本机、SLURM、HyperQueue、PBS Pro、PBS/Torque、SGE、LSF、Flux、HTCondor、Moab、OAR、NQSII、Bridge，以及 Google/AWS/Azure Batch 和 Kubernetes。runner 启动前检查所选执行器的提交命令（如 `sbatch`、`hq`）和本机运行时的命令（如 `conda`、`apptainer`）是否在 PATH 里。集群和云执行器的工作目录要写计算节点能访问的绝对路径或对象存储地址。Apple Silicon 上用 Docker 时自动加 `emulate_amd64`。执行器设置写进单独的 `run.config`，运行时用 `-profile`，参数写进 `params.json`，runner 在独立项目目录里执行：

  ```bash
  nextflow run . -profile docker -c run.config -params-file params.json
  ```

- 运行记录页（`/runs`）和详情页（`/runs/<id>`）显示状态、进度、命令、配置和当时的项目快照，运行中可以停止。
- 新运行不默认加 `-resume`。从已结束运行详情选择「从此运行恢复」，服务端使用明确的 session ID、原项目和 work/cache，日志与结果按尝试隔离。删除记录保留计算文件，不自动清理其他尝试依赖的缓存。

### `/api/runs` 接口

| 方法     | 路径                    | 说明                                                                        |
| -------- | ----------------------- | --------------------------------------------------------------------------- |
| `GET`    | `/api/runs?workflowId=` | 运行列表（`RunSummary[]`）                                                  |
| `POST`   | `/api/runs`             | 启动：`LaunchRequest`（流程、项目文件、参数、启动配置、`run.config`、命令） |
| `GET`    | `/api/runs/:id`         | 运行详情（`RunDetail`）                                                     |
| `POST`   | `/api/runs/:id/cancel`  | 停止，已结束返回 409                                                        |
| `POST`   | `/api/runs/:id/resume`  | 从明确来源恢复，返回新运行记录                                              |
| `DELETE` | `/api/runs/:id`         | 删除记录                                                                    |

运行详情页可以实时查看：

- **流程图**：画布上的每个节点显示任务进度（完成、运行中、失败），点节点跳到它的任务。
- **任务**：每个任务的状态、耗时、CPU、峰值内存和退出码（和 Nextflow trace 的字段一致），点开看 `.command.log`。
- **日志**：`nextflow run -ansi-log false` 风格的控制台输出，出错时显示失败的进程和工作目录。
- **结果**：`--outdir` 下按模块分组的文件，HTML 报告、图片和文本文件可以直接预览（HTML 报告放在无脚本的沙箱 iframe 里）。

| 方法  | 路径                                  | 说明                                 |
| ----- | ------------------------------------- | ------------------------------------ |
| `GET` | `/api/runs/:id/tasks`                 | 任务列表（`TaskRecord[]`）           |
| `GET` | `/api/runs/:id/log`                   | 控制台日志 `{ lines }`               |
| `GET` | `/api/runs/:id/task-log?hash=`        | 单个任务的 `.command.log` `{ text }` |
| `GET` | `/api/runs/:id/results`               | outdir 下的文件（`ResultFile[]`）    |
| `GET` | `/api/runs/:id/results/content?path=` | 文件内容，按 `content-type` 返回     |

类型定义在 `src/features/runs/types.ts` 和 `src/features/runs/outputs.ts`。模拟后端（`src/mocks/runs.ts`）按流程结构确定性地推演任务进度；参数里设置 `simulate_failure: true` 可以模拟任务失败。

## AI 助手

顶栏的「AI 助手」打开 CopilotKit 侧边栏。模型在 Next.js 的 `/api/copilotkit` 路由里调用，API key 只在服务端；助手能用的工具在浏览器里注册和执行，所以它改画布和手动编辑一样，每一步都能撤销。

- **编辑器**：助手能看到当前流程（节点、端口、连线、参数和校验问题），可以搜索模块、添加节点、连线和断开、删除节点，修改别名、模块参数、`ext.args`/`ext.prefix`/资源标签/是否发布，以及设置流程参数。工具出错时会把原因返回给模型，模型据此修正后重试。`start_run` 会先弹出确认对话框，接受后才用运行对话框里保存的设置启动。
- **运行详情页**：助手能看到这次运行的状态、参数、命令和失败任务，可以读取任务的 `.command.log` 和 Nextflow 主日志来解释失败原因。`cancel_run` 和 `resume_run` 同样要先确认，取消或关闭对话框不会停止或恢复。

助手默认优先使用本机已经 `codex login` 的 Codex CLI（`COPILOT_BACKEND=auto`）。认证留在 `~/.codex`，服务端不读取 token，这条路径也不需要 `OPENAI_API_KEY`。Codex 不可用时才退回下面的 API key 模型。顶栏按钮的提示会写明当前后端；`GET /api/copilotkit/status` 返回 `backend` 是 `codex` 还是 `builtin`，未启用时 `message` 说明原因。

`/api/copilotkit` 只接受本机回环地址上的同源请求（`localhost`、`127.0.0.1`、`::1`；需要别的回环名时设置 `COPILOT_ALLOWED_HOSTS`）。Codex 同时最多处理 `CODEX_MAX_SESSIONS` 个会话（默认 2，再多返回 429）。每次 Codex 对话的工作目录是空的临时目录，不是项目仓库。一轮用户消息里最多再调用模型 12 次；未知工具，以及说明文字和工具 JSON 混在同一段回复里，都会被拒绝，不会执行。

在 `.env.local` 里配置：

```bash
# auto（默认）| codex | builtin
COPILOT_BACKEND=auto
# 可选：CODEX_MODEL=gpt-5.4
# 可选：CODEX_BIN=/usr/local/bin/codex

# builtin 后端。COPILOT_MODEL 形如 <provider>/<model>
ANTHROPIC_API_KEY=sk-ant-...
# 也支持 openai/<model>（OPENAI_API_KEY）和 google/<model>（GOOGLE_API_KEY）
COPILOT_MODEL=anthropic/claude-sonnet-5-5
```

没有 Codex 登录、也没有对应 key 时，按钮会变灰并提示原因，应用的其他功能不受影响。代码在 `src/features/assistant`。宿主只负责会话和确认；每个能力模块在 `src/features/assistant/modules/` 注册自己的工具和提示词。`modules/compose.ts` 拼出提示词，没有点名模块时用 `defaultActive` 的模块。浏览器里的工具仍在浏览器执行。

## 开发

### 真实 Nextflow 测试

Vitest 里的 Nextflow 模式测试和 host-chain 测试会直接调用 `nextflow`，二进制不存在时失败而不是跳过。`bash scripts/install-nextflow.sh` 安装官方 GitHub release 中的 26.10.4 launcher（本机需已有 Java 17–26，脚本不安装 JDK）。CI 在 Temurin 21 之后执行同一脚本。Cloud Agent 环境不读取仓库里的 `environment.json`，需要在 dashboard 的 `install` 里运行该脚本，镜像里已有的 OpenJDK 21 即可。

可通过 `NEXTFLOW_STUDIO_DATA_DIR` 设置数据目录，`NEXTFLOW_STUDIO_CACHE_DIR` 设置缓存目录；`NEXTFLOW_BIN`、`DOCKER_BIN` 指定可执行文件；`NEXTFLOW_JAVA_HOME` 指定 JDK。需要代理时用 `NEXTFLOW_HTTP_PROXY` 指定 HTTP 代理地址，子进程会忽略 Nextflow 不支持的 SOCKS 代理变量。

### 从网页启动真实运行

需要 Node.js >=22.13（使用内置 SQLite；Node 22 会打印实验性 API 提示），以及以上本机工具。分别在两个终端启动：

```bash
pnpm runner      # 独立执行服务；先等到 Runner ready
pnpm dev:real    # 另一个终端，http://127.0.0.1:3000
```

runner 启动时写入一个内置示例流程（host-chain：用本机 shell 命令串起各种通道模式），输入是它创建的合成文本数据。点击「运行 → 启动运行」，即可查看真实任务、日志和下载结果。默认任务上限 2 CPU / 2 GB，可在运行弹窗调整；输出和 work 目录由服务端隔离管理。自备数据时，`--input` 和参考文件参数必须是 runner 主机上的绝对路径。

本机 web 默认只监听 127.0.0.1，执行可信工作流。runner 按执行器分槽位排队：本机执行器同一时间只跑一个运行（任务都在这台机器上，避免 CPU/内存超订）；集群和云执行器的 Nextflow head 只负责提交作业，默认可同时跑 4 个，用 `NEXTFLOW_STUDIO_REMOTE_SLOTS` 调整。两类各自先到先跑，本机运行排队时不挡集群运行。runner 落盘提交时生成的项目快照（模块之后重新发布也不影响这次运行），用 `nf-weblog@1.2.0` 采集真实状态，trace 最终对账；运行图中的任务数随数据流展开。取消会向 Nextflow 进程组发 SIGTERM（本机 10 秒、集群/云 60 秒后 SIGKILL），并清理带本次运行标签的容器。Nextflow head 在独立进程组里运行，输出直接写日志文件，所以 runner 停止或崩溃时运行不中断；重启后 runner 核验原进程身份并重新接管，复用上次的事件端口继续接收 weblog（端口被占用时改为轮询 trace）。head 在 runner 停止期间结束的，按 `.nextflow/history` 记录的 OK/ERR 判定成功或失败。只有还在准备阶段的运行会被标记中断。重启 web 不影响独立 runner。

数据目录默认在 Linux 上是 `${XDG_DATA_HOME:-~/.local/share}/nextflow-studio/`，macOS 上是 `~/Library/Application Support/Nextflow Studio/`（已有 `~/.local/share/nextflow-studio/studio.sqlite` 时继续用旧位置）。其中 `studio.sqlite` 保存工作流和运行状态，`host-chain/` 保存示例输入；`library/modules/<namespace>/<name>/<version>/` 是模块库，每个发布版本一个目录，内容和生成项目里的模块目录相同，另有 `notebook.py|R`（percent 格式笔记本）和 `module.json`，设 `NEXTFLOW_STUDIO_MODULE_LIBRARY` 可指向共享目录（比如团队的 Git 仓库）；`pipelines/<流程 id>/` 是每个流程固定的项目和 launch 目录，每次运行只重写有变化的文件，`.nextflow/` 历史和缓存库也在这里；`work/` 是所有流程共用的本机 work 目录；`executions/<lineage>/attempts/<run-id>/` 保存各次参数、日志、trace、报告、结果和当次运行的项目副本 `project/`。

固定项目目录是因为 Nextflow 把 `bin/` 和模块 `resources/usr/bin/` 里的脚本按路径和修改时间算进任务哈希，项目换目录或被整体重写后 `-resume` 就找不到缓存。同一流程的运行因此按顺序执行。结果用 `publishDir` 发布：work 和结果目录在同一文件系统上时用硬链接（`link`，不占额外空间，清理 work 后结果仍在），否则复制。

缓存目录默认在 Linux 上是 `${XDG_CACHE_HOME:-~/.cache}/nextflow-studio/`，macOS 上是 `~/Library/Caches/Nextflow Studio/`。runner 把 `NXF_CONDA_CACHEDIR` 指到其中的 `conda/`、`NXF_SINGULARITY_CACHEDIR` 和 `NXF_APPTAINER_CACHEDIR` 指到 `singularity/`（环境里已设置的值优先），笔记本试跑的 conda 环境也放在同一个 `conda/`。

日志接口返回有界尾部，下载接口返回完整文件；HTML 使用去脚本的沙箱静态预览，完整交互报告可下载。

可执行完整 API 验收（需要 web 和 runner 都已启动，会新增验收记录）：

```bash
pnpm smoke:runner # 幂等提交 → 实时任务 → 成功/下载 → 缓存续跑 → 运行中取消 → 缺失输入失败
```

### 端到端验收（Playwright）

`pnpm build:real && pnpm test:e2e` 启动真实 runner 和 web，用浏览器走完整闭环：

- `e2e/user-path.spec.ts`：Python 和 R 笔记本出图、发布、画布运行、源改动提示、发布 v2 后从原运行恢复命中缓存。
- `e2e/single-cell.spec.ts`：两本 scanpy 笔记本（质控、聚类）在常驻 Jupyter 内核里逐格运行，用本机 Python 试跑后发布；画布上把「参考文件」接到质控、再接到聚类，用 Shell 运行时跑真实 Nextflow，结果页显示 UMAP 和 marker 表。数据由 `scripts/make-pbmc-demo.py` 准备：优先 `PBMC3K_H5AD` 指向的文件，其次下载 10x PBMC 3k，都不可用时生成确定性的合成 PBMC 计数。

需要 `python3 -m pip install ipykernel matplotlib scanpy igraph leidenalg`，R 部分另需 `Rscript`。runner 首次运行要从 Nextflow 插件仓库下载 `nf-weblog@1.2.0`。

### Codex harness

`src/features/codex-harness` 用本机 `codex app-server` 的 stdio JSON-RPC 开一个会话，方便以后用已经 `codex login` 的订阅驱动助手。认证留在 `~/.codex`，代码不读取 token。没有安装 CLI 时 `pnpm test` 仍通过（测试使用假的 stdio）。对真实登录跑一轮：

```bash
pnpm codex:smoke
pnpm codex:smoke -- Reply with the single word pong
```

说明见 `src/features/codex-harness/README.md`。

生产模式先 `pnpm build:real`，再分别运行 `pnpm runner` 和 `pnpm start`。公共环境变量在构建时固化，因此真实生产构建必须使用 `build:real`。

演示模式的数据保存在浏览器 `nf-studio-mock-db-v2`，不会自动导入为真实数据。可以先在 `pnpm dev` 演示模式导出 JSON，再在真实模式导入并保存；模拟运行历史不会冒充真实执行记录。

```bash
pnpm install
pnpm dev               # http://localhost:3000
pnpm storybook         # http://localhost:6006
pnpm test              # 端口兼容性、校验、项目生成、运行模拟等单元测试
pnpm typecheck && pnpm lint && pnpm build
```

`pnpm dev` 默认保留 MSW 演示模式；`pnpm dev:real` 或 `NEXT_PUBLIC_API_MOCKING=disabled` 使用真实 API。切换到真实模式会注销本应用的 mock Service Worker。

### 前端组件开发

组件分层、Storybook 状态示例、浏览器测试和主题约定见 [前端开发指南](docs/frontend-development.md)。运行 `pnpm test:storybook` 可执行 Chromium 中的故事交互和可访问性检查；首次运行先执行 `pnpm exec playwright install chromium`。
