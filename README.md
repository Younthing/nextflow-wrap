# Nextflow Studio (nextflow-wrap)

ComfyUI 式的 Nextflow 可视化前端：在笔记本里写分析脚本并发布成模块，在画布上用这些模块和内置节点搭建流程，一键运行，实时追踪任务并查看结果。生成的是不依赖插件的标准 Nextflow 项目，可直接用 `nextflow run` 运行。

- 使用说明：[用户指南](docs/user-guide/README.md)，两节入门课分别是单细胞（PBMC 3k）和分子对接（AutoDock Vina）。新数据目录自带的示例项目是一个普通项目：四本表达分析笔记本（质控、标准化与 PCA、组间比较、汇总报告）和把它们连起来的流程，另有免疫荧光主题的示例。
- 项目文件夹的结构、保存冲突和运行记录的位置见 [项目工作台](docs/project-workbench.md)。
- 桌面版（macOS / Linux / Windows，服务端跑在本机、WSL 或 SSH 远程机器上）：见 [desktop/README.md](desktop/README.md)。
- 其他文档：[独立服务端](docs/server.md)、[桌面版发布](docs/desktop-release.md)、[前端开发指南](docs/frontend-development.md)、[液态玻璃主题](docs/liquid-glass.md)、[接下来的计划](docs/roadmap.md)。早期的真实执行接入计划和验收记录已移到 [docs/archive/](docs/archive/)，只作历史参考。

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

- 模块库只有两类：笔记本发布、试跑通过的自定义模块，和随产品提供的内置节点（输入、通道算子、功能节点）。示例项目在 `src/features/notebook/examples.ts`，服务端和演示模式都从它播种；测试和 Storybook 另用 `src/features/workflow/fixture-modules.ts` 里的模块。
- 端口按通道元素类型着色：文件、值、meta、目录。连线时校验元组结构，必要时自动补齐可选文件（`[]`）或去掉 meta；文件格式不一致会给出提醒并画成虚线。
- 汇总报告这类收集输入可以连接多个输出，会自动 `mix` 并 `collect`。
- 只接受值的输入（布尔、字符串、数字）直接显示为节点上的控件。
- 双击画布搜索模块；把连线拖到空白处会搜索能接上的模块并自动连线。
- 右侧面板编辑节点配置（`ext.args`、`ext.prefix`、资源标签、是否发布）或流程参数（按 `nextflow_schema.json` 自动生成）。
- 撤销/重做（Ctrl+Z / ⌘Z，重做 Ctrl+Shift+Z / ⇧⌘Z，也可 Ctrl+Y / ⌘Y），Ctrl+S / ⌘S 保存，已保存的流程会自动保存；也可以导入/导出 JSON。
- 复制、粘贴、创建副本（Ctrl+C / ⌘C、Ctrl+V / ⌘V、Ctrl+D / ⌘D）。Delete 或 Backspace 删除选中的节点和连线，撤销可恢复。粘贴只保留选区内部的连线。Ctrl+A / ⌘A 全选，Esc 取消选择。Ctrl+K / ⌘K 或 / 打开节点搜索，F 或 Shift+1 / ⇧1 适应视图（有选中节点时对准选区）。

## 笔记本

- 笔记本存成所属项目文件夹里的标准 `.ipynb` 文件（默认在 `notebooks/`，也可以建在任意子文件夹；第一次在项目里保存分析文档时补上 `studio.json`），能直接用 JupyterLab、VS Code 打开或提交到 Git。单元格角色（input / output / explore）和笔记本说明放在 `metadata.nextflow_studio` 里，Jupyter 保存时会保留；输出不写进文件。在应用外改过的文件会自动载入；应用里保存时如果文件已在外部被改过，不会覆盖，而是给出比较、重新载入、另存为副本或明确覆盖。项目里的其他 `.ipynb`（包括复制出来的副本）会成为新笔记本，在文件区改文件名就是给笔记本改名，发布的模块也用这个名字。修订历史和试跑记录在项目的 `.studio/state.sqlite`，可由文件重建。
- Python 笔记本的单元格在常驻 Jupyter 内核里运行，每本笔记本一个内核，内核从项目根目录启动，所以单元格里可以直接读 `data/reads.fq` 这样的相对路径；变量在多次运行之间保留。运行单个单元格只跑这一格；「运行全部」先重启内核，再从第一格依次运行，遇到报错停下。工具栏显示内核状态，可以中断正在跑的单元格或重启内核。
- 内核选择器列出本机已安装的 Jupyter kernelspec（如 `python -m ipykernel install --user --name scanpy` 注册的环境）。笔记本记的内核名不是已安装的 kernelspec 时改用 `python3`，并在工具栏下方说明。
- 需要 `python3 -m pip install ipykernel`（`NEXTFLOW_STUDIO_JUPYTER_PYTHON` 可换解释器）。没有 Jupyter 时退回旧行为：每次在新进程里从头运行到所选单元格。内核空闲 2 小时后自动关闭（`NEXTFLOW_STUDIO_KERNEL_IDLE_MS`）。R 笔记本同样在持久内核里运行，需要 IRkernel（在 R 里执行 `install.packages("IRkernel"); IRkernel::installspec()`）；没有 R 内核时 R 单元格只能编辑，试跑仍调用 `Rscript`。结果页能直接看 `.h5ad` 摘要（只读 HDF5 元数据，需要 `h5py`）和 PDB/PDBQT/SDF 结构（Mol*）。

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

助手默认（`COPILOT_BACKEND=auto`）按这个顺序选后端：本机已经 `codex login` 的 Codex CLI → 本机已经 `grok login` 的 Grok Build CLI（走 X／Grok 订阅；没登录时也可用 `XAI_API_KEY`）→ 下面的 API key 模型。`codex`、`grok`、`builtin` 强制只用一条路径。认证分别留在 `~/.codex`、`~/.grok`，服务端不读取 token，两条 CLI 路径都不需要 `OPENAI_API_KEY`／`ANTHROPIC_API_KEY`。顶栏按钮的提示会写明当前后端（「本机 Codex」「本机 Grok Build」或模型名）；`GET /api/copilotkit/status` 返回 `backend` 是 `codex`、`grok` 还是 `builtin`，未启用时 `message` 说明原因（例如「请先运行 grok login」）。页面不等这个接口：状态未知时侧栏的「AI 助手」按钮显示加载中。接口最多等 3 秒 CLI 探测，超时就返回 `reason: "status-timeout"`，探测在服务端继续跑并缓存结果，浏览器几秒后自动再问一次。

`/api/copilotkit` 只接受本机回环地址上的同源请求（`localhost`、`127.0.0.1`、`::1`；需要别的回环名时设置 `COPILOT_ALLOWED_HOSTS`）。Codex 同时最多处理 `CODEX_MAX_SESSIONS` 个会话，Grok 另算 `GROK_MAX_SESSIONS` 个（各自默认 2，再多返回 429）。每次 Codex／Grok 对话的工作目录是空的临时目录，不是项目仓库。Grok 对话另外：用只保留 `todo_write` 的聊天 agent profile（没有 shell、读写文件、联网工具），`GROK_SANDBOX=strict`，不开 `--always-approve`，权限请求一律拒绝。一轮用户消息里最多再调用模型 12 次；未知工具，以及说明文字和工具 JSON 混在同一段回复里，都会被拒绝，不会执行。

在 `.env.local` 里配置：

```bash
# auto（默认）| codex | grok | builtin
COPILOT_BACKEND=auto
# 可选：CODEX_MODEL=gpt-5.4
# 可选：CODEX_BIN=/usr/local/bin/codex
# 可选：CODEX_MAX_SESSIONS=2

# Grok Build：先在本机运行一次 grok login（token 留在 ~/.grok）
# 可选：GROK_MODEL=grok-4.7
# 可选：GROK_BIN=$HOME/.local/bin/grok
# 可选：GROK_MAX_SESSIONS=2
# 可选：GROK_CHAT_SANDBOX=strict（默认；只在明确需要时放宽）

# builtin 后端。COPILOT_MODEL 形如 <provider>/<model>
ANTHROPIC_API_KEY=sk-ant-...
# 也支持 openai/<model>（OPENAI_API_KEY）和 google/<model>（GOOGLE_API_KEY）
COPILOT_MODEL=anthropic/claude-sonnet-5-5
```

没有 Codex／Grok 登录、也没有对应 key 时，按钮会变灰并提示原因，应用的其他功能不受影响。代码在 `src/features/assistant`，按 VS Code Copilot + Jupyter 的 Language Model Tools 拆法分四层：宿主（`copilot-route.ts`、`assistant-provider.tsx`）只管会话、后端选择、并发和确认对话框；场景模块（`modules/`）声明提示词片段和工具名、说明；页面挂载的 surface（`surfaces/`）用 `useFrontendTool` 注册工具；工具真正做的事放在各领域的 `assistant-actions.ts`（`features/editor`、`features/runs`、`features/notebook`）。每轮请求只带页面上挂着的模块，没有挂载就只有宿主提示词。会改动运行或执行代码的工具（`start_run`、`cancel_run`、`resume_run`、`run_notebook_cell`）先弹确认对话框。浏览器里的工具仍在浏览器执行。

## 开发

### 真实 Nextflow 测试

Vitest 里的 Nextflow 模式测试（`src/features/project/patterns.test.ts` 等）会直接调用 `nextflow`，二进制不存在时失败而不是跳过。`bash scripts/install-nextflow.sh` 安装官方 GitHub release 中的 26.10.4 launcher（本机需已有 Java 17–26，脚本不安装 JDK）。CI 在 Temurin 21 之后执行同一脚本。Cloud Agent 环境不读取仓库里的 `environment.json`，需要在 dashboard 的 `install` 里运行该脚本，镜像里已有的 OpenJDK 21 即可。

可通过 `NEXTFLOW_STUDIO_DATA_DIR` 设置数据目录，`NEXTFLOW_STUDIO_CACHE_DIR` 设置缓存目录；`NEXTFLOW_BIN`、`DOCKER_BIN` 指定可执行文件；`NEXTFLOW_JAVA_HOME` 指定 JDK。需要代理时用 `NEXTFLOW_HTTP_PROXY` 指定 HTTP 代理地址，子进程会忽略 Nextflow 不支持的 SOCKS 代理变量。

### 从网页启动真实运行

需要 Node.js >=22.13（使用内置 SQLite；Node 22 会打印实验性 API 提示），以及以上本机工具。分别在两个终端启动：

```bash
pnpm runner      # 独立执行服务；先等到 Runner ready
pnpm dev:real    # 另一个终端，http://127.0.0.1:3000
```

新数据目录自带示例项目（表达分析笔记本和连接它们的流程，另有免疫荧光示例）。在工作台打开流程，点击「运行」（第一次可先在「运行设置」里选环境），即可查看真实任务、日志和下载结果。默认任务上限 2 CPU / 2 GB，可在「运行设置」里调整。自备数据时，`--input` 和文件输入、文件夹输入节点上的路径相对项目根目录（拖入或上传的文件进 `data/`），也可以写后端主机上的绝对路径或对象存储地址。

本机 web 默认只监听 127.0.0.1，执行可信工作流。runner 按执行器分槽位排队：本机执行器同一时间只跑一个运行（任务都在这台机器上，避免 CPU/内存超订）；集群和云执行器的 Nextflow head 只负责提交作业，默认可同时跑 4 个，用 `NEXTFLOW_STUDIO_REMOTE_SLOTS` 调整。两类各自先到先跑，本机运行排队时不挡集群运行。runner 落盘提交时生成的项目快照（模块之后重新发布也不影响这次运行），用 `nf-weblog@1.2.0` 采集真实状态，trace 最终对账；运行图中的任务数随数据流展开。取消会向 Nextflow 进程组发 SIGTERM（本机 10 秒、集群/云 60 秒后 SIGKILL），并清理带本次运行标签的容器。Nextflow head 在独立进程组里运行，输出直接写日志文件，所以 runner 停止或崩溃时运行不中断；重启后 runner 核验原进程身份并重新接管，复用上次的事件端口继续接收 weblog（端口被占用时改为轮询 trace）。head 在 runner 停止期间结束的，按 `.nextflow/history` 记录的 OK/ERR 判定成功或失败。只有还在准备阶段的运行会被标记中断。重启 web 不影响独立 runner。

数据目录默认在 Linux 上是 `${XDG_DATA_HOME:-~/.local/share}/nextflow-studio/`，macOS 上是 `~/Library/Application Support/Nextflow Studio/`（`NEXTFLOW_STUDIO_DATA_DIR` 可改）。数据目录只放跨项目的东西：

- `workspace-registry.sqlite`：最近打开的项目、运行环境状态和共享模块库（发布到共享库的模块版本，安装时复制进项目）。没有迁移，格式版本不同时服务端拒绝打开；桌面版会在启动前删掉它重建：项目文件夹不受影响，但共享模块库会清空。
- `workspaces/default/`：示例项目（`NEXTFLOW_STUDIO_WORKSPACE` 可换位置）。
- `settings.json`、`secrets.json`（设置和密钥；权限 0600，只有桌面版通过系统钥匙串传入 `NEXTFLOW_STUDIO_SECRET_KEY` 时才用 AES-256-GCM 加密，独立服务端或没有可用钥匙串的 Linux 上是明文）、`toolchain/`（应用安装的 JRE、Nextflow、nf-weblog、micromamba，按版本分目录）、`logs/`。
- `studio.sqlite`：项目化之前的旧数据库，只读；仍有流程或模块时工作台首页会提议导入。

项目本身是一个普通文件夹（详见 [项目工作台](docs/project-workbench.md)）：`studio.json` 记项目 id 和格式版本；笔记本（`.ipynb`，默认 `notebooks/`）和流程画布（`.workflow.json`，默认 `workflows/`）是权威文件；发布的模块是 `modules/<名称>/<版本>/` 下不可变的版本目录；每次运行在 `runs/<运行 id>/`（参数、日志、trace、报告、`results/` 和当次项目快照）；`.studio/state.sqlite` 是可从文件重建的索引，`.studio/runtime/workflows/<流程 id>/` 是每个流程固定的 launch 目录（`.nextflow/` 历史和缓存库也在这里），`.studio/runtime/work/` 是项目的本机 work 目录。

固定 launch 目录是因为 Nextflow 把 `bin/` 和模块 `resources/usr/bin/` 里的脚本按路径和修改时间算进任务哈希，项目换目录或被整体重写后 `-resume` 就找不到缓存。同一流程的运行因此按顺序执行。结果用 `publishDir` 发布：work 和结果目录在同一文件系统上时用硬链接（`link`，不占额外空间，清理 work 后结果仍在），否则复制。

缓存目录默认在 Linux 上是 `${XDG_CACHE_HOME:-~/.cache}/nextflow-studio/`，macOS 上是 `~/Library/Caches/Nextflow Studio/`。runner 把 `NXF_CONDA_CACHEDIR` 指到其中的 `conda/`、`NXF_SINGULARITY_CACHEDIR` 和 `NXF_APPTAINER_CACHEDIR` 指到 `singularity/`（环境里已设置的值优先），笔记本试跑的 conda 环境也放在同一个 `conda/`。

日志接口返回有界尾部，下载接口返回完整文件；HTML 使用去脚本的沙箱静态预览，完整交互报告可下载。

### 远程集群（SSH）

设置页「远程集群」保存登录节点（主机、用户、端口、私钥、集群上的基础目录、Nextflow 命令、登录后执行的一行命令），运行时选「从哪里启动 Nextflow」。runner 用系统 `ssh`（`BatchMode=yes`，控制套接字复用连接；脚本经 stdin 交给 `sh -s` / `bash -l -s`，不经登录 shell 解析）：

1. 检查集群上的 Nextflow、调度器命令和运行时；
2. 把流程的启动目录用 tar（保留修改时间，`-resume` 才能命中缓存）复制到 `<基础目录>/pipelines/<流程 id>/`，`run.config`、`params.json` 放到 `<基础目录>/runs/<运行 id>/`，默认 work 目录是 `<基础目录>/work`；参数里用到的项目数据（以及项目样本表列出的文件）同步到 `<基础目录>/projects/<项目>/`，每次运行读取 `<基础目录>/snapshots/<项目>/` 下按数据状态命名的硬链接快照，所以之后的同步不改变正在用的数据，数据不变时续跑仍命中缓存；
3. 在登录节点上用 `setsid nohup` 启动 Nextflow（退出码写入 `exit-code`），记录 pid 和启动时间；
4. 每 `NEXTFLOW_STUDIO_REMOTE_POLL_MS`（默认 10000）毫秒经 ssh 读一次存活状态、trace 和控制台尾部；取消发 SIGTERM，60 秒后 SIGKILL；ssh 断开 30 分钟内持续重试；runner 重启后按记录的 pid 重新接管；
5. 结束后取回日志、报告、`.nextflow/history`（拿到 session 供续跑）和结果；结果超过 `NEXTFLOW_STUDIO_REMOTE_FETCH_MAX_MB`（默认 2048）时留在集群上。任务日志在查看时经 ssh 读取。

`NEXTFLOW_STUDIO_SSH` 可换用别的 ssh 程序；`scripts/ssh-shim.sh` 把"远程"命令改在本机执行，测试和下面的验收用它，不需要真实集群：

```bash
NEXTFLOW_STUDIO_SSH=$PWD/scripts/ssh-shim.sh NEXTFLOW_STUDIO_REMOTE_POLL_MS=1000 pnpm runner   # 另开终端启动 web（同样的环境变量）
pnpm smoke:remote # 测试连接 → 集群上运行成功 → 结果取回 → 经 ssh 读任务日志 → 集群缓存续跑 → 停止
```

云端执行器（AWS / Google / Azure Batch、Kubernetes）仍由本机 Nextflow 提交；设置页「云端凭据」里的 profile、区域、服务账号文件和账户名映射为 `AWS_PROFILE`、`AWS_REGION`、`GOOGLE_APPLICATION_CREDENTIALS`、`AZURE_BATCH_ACCOUNT_NAME` 等变量，访问密钥（`AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY`、`AZURE_BATCH_ACCOUNT_KEY`、`AZURE_STORAGE_ACCOUNT_KEY`）和 API key 一样只写，存进 `secrets.json`（加密条件见上面的数据目录说明），runner 重启后生效。

可执行完整 API 验收（需要 web 和 runner 都已启动，会新增验收记录）：

```bash
pnpm smoke:runner # 幂等提交 → 实时任务 → 成功/下载 → 缓存续跑 → 运行中取消 → 缺失输入失败
```

### 端到端验收（Playwright）

`pnpm build:real && pnpm test:e2e` 启动真实 runner 和 web，用浏览器走完整闭环：

- `e2e/user-path.spec.ts`：Python 和 R 笔记本出图、发布、画布运行、源改动提示、发布 v2 后从原运行恢复命中缓存。
- `e2e/single-cell.spec.ts`：两本 scanpy 笔记本（质控、聚类）在常驻 Jupyter 内核里逐格运行，用本机 Python 试跑后发布；画布上把「文件输入」接到质控、再接到聚类，用 Shell 运行时跑真实 Nextflow，结果页显示 UMAP 和 marker 表。数据由 `scripts/make-pbmc-demo.py` 准备：优先 `PBMC3K_H5AD` 指向的文件，其次下载 10x PBMC 3k，都不可用时生成确定性的合成 PBMC 计数。

- `e2e/docking.spec.ts`：RDKit 笔记本把 SMILES 变成 3D 配体，Vina 笔记本在 CPU 上对接；两个文件输入（配体表、受体）接入画布，真实 Nextflow 运行后结果页显示打分表，最佳构象在 Mol* 里打开。数据由 `scripts/make-docking-demo.py` 准备（默认是离线的合成口袋）。
- `e2e-desktop/packaged.spec.ts`：打包后的桌面应用（`pnpm --dir desktop dist:linux`）用 Playwright 的 Electron 驱动启动，验证格式不兼容的项目注册表被重置而设置保留，以及笔记本模块在应用里生成项目并真实运行。命令：`xvfb-run pnpm exec playwright test -c e2e-desktop/playwright.config.ts`。

需要 `python3 -m pip install ipykernel matplotlib h5py scanpy igraph leidenalg vina meeko gemmi scipy rdkit`，R 部分另需 `Rscript`。runner 首次运行要从 Nextflow 插件仓库下载 `nf-weblog@1.2.0`；下载不到时进度改为每 3 秒读取 trace 文件。

### Codex harness

`src/features/codex-harness` 用本机 `codex app-server` 的 stdio JSON-RPC 开一个会话，方便以后用已经 `codex login` 的订阅驱动助手。认证留在 `~/.codex`，代码不读取 token。没有安装 CLI 时 `pnpm test` 仍通过（测试使用假的 stdio）。对真实登录跑一轮：

```bash
pnpm codex:smoke
pnpm codex:smoke -- Reply with the single word pong
```

说明见 `src/features/codex-harness/README.md`。

### Grok Build harness

`src/features/grok-harness` 用本机 `grok agent stdio`（ACP，按行分隔的 JSON-RPC 2.0）开会话，让助手用已经 `grok login` 的 X／Grok 订阅。认证留在 `~/.grok`，代码不读取 token；探测只看 `session/new` 是否回 `Authentication required`，不发 prompt、不花 token。没有安装 CLI 时 `pnpm test` 仍通过（测试使用假的 ACP 对端）。对真实登录跑一轮：

```bash
grok login            # 一次即可
pnpm grok:smoke       # 1) harness 一轮必须回文本 2) 助手层一轮必须把工具 JSON 变成 AG-UI 工具调用
pnpm grok:smoke --model grok-4.7-build-fast -- Reply with the single word pong
COPILOT_BACKEND=grok pnpm dev   # 顶栏应显示「本机 Grok Build」
```

说明见 `src/features/grok-harness/README.md`。

生产模式先 `pnpm build:real`，再分别运行 `pnpm runner` 和 `pnpm start`。公共环境变量在构建时固化，因此真实生产构建必须使用 `build:real`。

演示模式的数据保存在浏览器 `nf-studio-mock-db-v3`，不会自动导入为真实数据。可以先在 `pnpm dev` 演示模式导出 JSON，再在真实模式导入并保存；模拟运行历史不会冒充真实执行记录。

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
