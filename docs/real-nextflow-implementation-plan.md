# 真实 Nextflow 执行接入计划

更新日期：2026-10-31。本文保留原实施路线；本机第一版已实现，实际验收记录见 [实现与验收](real-nextflow-validation.md)。

## 实施状态

- 已实现环境预检、项目落盘、明确版本的依赖安装与校验。
- 已实现 SQLite、工作流 CRUD、运行 API、独立 runner、实时任务事件、trace 对账、真实日志和结果下载。
- 已实现本机 Docker 执行、幂等提交、取消、明确来源的缓存恢复、runner 异常退出恢复。
- CLI 已验证单/双端 FastQC + MultiQC，以及 fastp + 微型 STAR 分支；网页实际启动、任务日志和下载已通过浏览器验证。
- 第一版边界仍为本机单用户可信工作流。远程执行器、多用户鉴权、大文件上传和磁盘缓存清理界面继续按后续范围推进。

## 目标与边界

第一版面向本机、单用户、可信流程：从画布提交真实运行，在浏览器查看真实日志、任务、结果，支持取消、重启后的状态恢复、明确来源的断点续跑。采用 local executor + Docker，初始最多一个活动运行。远程执行器保留类型与扩展接口，在能力接口未声明支持时禁用。

先打通 `Samplesheet → FastQC → MultiQC`，再验证 `Samplesheet → fastp → FastQC → MultiQC`，最后使用微型参考序列验证现有 STAR 分支。完整人类参考基因组不作为首次验收数据。

## 已确认现状

- 已确认 Nextflow 26.10.4（`/opt/homebrew/bin/nextflow`）、Conda 26.9.4（`/Users/qin/miniconda3/bin/conda`）、nf-core/tools 4.2.1（`/Users/qin/miniconda3/bin/nf-core`）均可执行；Docker CLI 与 daemon 均为 29.9.2，daemon 架构 aarch64。Java 报告 27.0.1，机器为 arm64。
- 当前非交互 shell 没有加载 Conda 初始化，因此 PATH 中找不到 conda/nf-core，但使用上述绝对路径已验证成功。runner 应显式配置工具路径与所需环境，不依赖交互式 `.zshrc`。
- `nextflow -version` 提示忽略不支持的 SOCKS5 代理值；首次依赖下载前需要验证 runner 实际网络环境。
- 官方安装页目前列出 Java 17–26，建议 runner 使用 Java 21 LTS 并固定 JAVA_HOME；打印版本成功不等于整条流程兼容。
- `src/features/project/generate.ts` 已生成项目、参数 schema 和模块清单；`templates.ts` 使用 Nextflow 最低版本 25.10.4、nf-schema 2.7.3，目录中的模块元数据锁定提交 `8bc51f2971a284eba5629c9e7c53474933a339aa`。
- `src/features/runs/queries.ts` 已定义运行接口与 1–2 秒轮询；运行图、任务、日志、结果 UI 可以复用。
- 除 CopilotKit 外，业务 API 仍由 MSW 提供；工作流保存在浏览器 localStorage。禁用 MSW 会同时失去模块目录、schema、健康检查和工作流 CRUD。
- 项目包含远程组件引用，但尚无真实组件安装器；现有生成测试主要验证文本，不能证明 Nextflow 编译与执行成功。
- `assets/samplesheet.csv` 含 `/path/to/...` 占位路径；`testConfig()` 使用 viralrecon 测试数据；默认 `resume: true`；本机“最多 CPU/内存”现在写入单任务 resourceLimits，尚未独立表达执行器的总资源预算。

## 架构决定

浏览器 → Next.js Node Route Handlers → SQLite 运行队列/持久化 → 独立 TypeScript runner → Nextflow → Docker 任务。

Next.js 负责请求验证、查询、工作流保存和文件下载。runner 负责依赖安装、进程生命周期、日志落盘、事件接收和状态归并，不能依赖某个 HTTP 请求或 Next.js 热更新进程的存活。runner 的事件接收端只监听回环地址，使用每次运行的独立凭证；数据库事务确保只能领取一次任务。开发环境提供独立 `pnpm runner`；长期运行由本机进程管理器分别管理 web 与 runner。

SQLite 保存 workflows、runs、task_attempts、run_events、artifacts、runner_leases；启用迁移与事务，数据库库的选型需与实际 Node 版本验证。大文件和完整日志放磁盘，不塞进数据库。

建议目录：

```text
src/features/runs/server/       # run-service、repository、preflight、materialize、runner、events、trace、artifacts
src/features/workflow/server/   # workflow repository/service
src/lib/server/                # database、paths、process、配置
src/app/api/                    # 薄 Route Handlers，Node runtime
scripts/runner.ts
scripts/smoke-nextflow.ts
tests/fixtures/nextflow/        # 微型 FASTQ / 样本表 / 参考数据与来源
```

数据根目录由 `NEXTFLOW_STUDIO_DATA_DIR` 配置，默认建议使用项目之外的用户数据目录。目录按运行链和尝试区分：

```text
data/studio.sqlite
data/components/<repo-sha>/...
data/executions/<lineage-id>/project/   # 固定生成项目，launch cwd；保留 .nextflow
data/executions/<lineage-id>/work/
data/executions/<lineage-id>/attempts/<run-id>/
  params.json, run.config, manifest.json, console.log, nextflow.log,
  trace.tsv, report.html, timeline.html, results/
```

同一运行链恢复时共享 launch cwd、Nextflow cache 和 work；每次尝试单独保存参数、日志和报告。对同一链加排他锁。输入数据路径稳定化；结果目录按尝试隔离，验证这不会使预期复用的计算任务失去缓存，允许报告任务重新执行。

## 阶段 0：环境预检

1. 检查 runner 实际使用的 Nextflow、Java、Git、nf-core/tools、Docker CLI 与 daemon，而不是只查浏览器或开发 shell。
2. 为 runner 固定受支持的 Java；固定通过验收的 Nextflow、nf-core/tools 与插件版本，保留版本诊断信息。
3. 检查 Docker VM 的 CPU、内存、文件共享与镜像架构；arm64 优先使用已验证的原生镜像，缺少原生镜像时明确使用现有 `emulate_amd64` profile。现有 arm64 profile 会启用 Wave，不应被当成无网络的简单架构开关。
4. 验证 GitHub、插件仓库和容器仓库下载。修正 runner 的代理配置，不盲目沿用当前 SOCKS5 值；镜像地址改写需验证实际仓库和镜像内容。
5. 先执行不依赖 nf-core 的本地 hello 流程，再执行容器 hello。

验收：两种 hello 成功；`/api/health` 展示真实版本、runner 心跳、容器可用性和逐项诊断；环境不可用时不允许提交执行。

## 阶段 1：脱离 UI 验证生成项目

1. 增加微型质控工作流与合法、可重复的 FASTQ fixture；单端和双端均覆盖。附数据来源、大小和校验和。
2. 用现有 `generateProject()` 生成真实文件，修复 samplesheet 与 test profile，明确相对路径解析基准。第一版以 runner 主机可读取的本地路径为输入，不把浏览器本地路径等同于服务器路径。
3. 实现组件安装：区分 modules 与 subworkflows，使用明确组件名和锁定 SHA，禁止交互等待。官方 CLI 支持 `--sha`，子流程会牵涉传递依赖，安装后需要验证完整依赖树。
4. 处理生成的 modules.json 已声明“安装”但目录尚不存在的情况：将预期锁与安装阶段分开，在临时目录完整安装后再发布。记录所有实际依赖的 SHA、文件校验和与来源，检测漂移；不要假定顶层 SHA 自动约束每个传递依赖。
5. 下载缓存按提交和安装清单索引，采用临时目录、锁和原子替换，避免中断留下貌似可用的缓存。包括模板、bin、插件和配置等被引用文件。
6. 审核远程 institutional config 引用：本机默认禁用不需要的远程 include；需要时锁定版本并记录来源。验证 nf-schema 2.7.3 与实际引擎兼容，再决定是否升级。
7. 运行解析/预览检查，再跑真实 FastQC + MultiQC；stub 仅辅助排查，不能作为真实执行验收。

验收：本机 CLI 使用生成的项目跑通两个样本，得到 FastQC HTML/ZIP 和包含这些样本的 MultiQC 报告，退出码为 0；所有依赖可追溯。生成器修改补行为测试。

## 阶段 2：持久化 API 与模拟切换

实现 `/api/health`、`/api/modules`、`/api/schemas/samplesheet`、工作流 CRUD，以及现有 `/api/runs` 契约。catalog 直接读取已提交的元数据，不手改生成 JSON。

服务端以校验后的 WorkflowDoc、params、launch 与锁定目录版本为输入重新生成项目，不执行浏览器传来的 command，也不直接信任客户端的 runConfig 或任意 project 文件。客户端预览和服务端使用同一生成器；目录版本不一致时返回可识别的错误。

保留已有响应形状，POST 可在持久化排队后返回 202 + RunDetail；添加客户端幂等键防止双击重复运行。拒绝不支持的执行器与 profile。

旧 localStorage 工作流提供显式导入、导出和 ID 映射；模拟运行记录保留模拟标记，不冒充真实执行。真实模式下避免旧 Service Worker 继续拦截 API，Storybook 和开发演示继续使用确定性 mock。

验收：关闭 MSW 后，工作流加载、保存、模块库和运行页面正常；重启服务仍能读取记录。

## 阶段 3：后台执行与状态机

1. runner 从 SQLite 事务领取任务，完成预检、生成、依赖安装后启动 Nextflow；初始全局并发为 1，后续再扩展。
2. 使用 `spawn(executable, argv, { shell: false, cwd, env })`。命令字符串仅展示，实际参数由服务端构造；固定工作目录、参数文件、配置文件与日志路径。
3. 资源设置区分单任务上限、执行器总 CPU/内存预算和队列并发，按 Docker VM 实际容量校验。
4. 保留 submitted/running/succeeded/failed/cancelled 主状态，增加 queued/preparing/executing/finalizing/cancelling 等 phase；失联可增加 interrupted 状态，更新所有轮询和展示映射。
5. 保存 PID/进程组、启动时间、runner 租约、Nextflow session ID、退出码和取消意图。生命周期事件与退出码共同归并，成功必须等输出核对结束；安装失败和生成失败也是可查询的运行记录。
6. stdout/stderr 持续落盘；区分控制台日志与 Nextflow 调试日志。对客户端提供有界尾部和增量游标，避免每两秒加载全部内容。
7. 所有服务端文件访问以数据根目录为边界；首版本仅本机可信流程。禁止跨站启动/取消请求，web 与事件端点默认回环监听。Nextflow/Groovy 和模块参数本身是可执行内容，`shell:false` 不构成不可信工作流沙箱。

验收：网页提交得到真实 PID；刷新或重启 Next.js 不终止任务；失败可定位到准备或执行阶段，浏览器没有伪造日志。

## 阶段 4：任务与日志采集

Nextflow 26.10 已不支持旧 `-with-weblog`；采用显式、固定版本的 nf-weblog 插件，并在阶段 1 验证兼容性。回调到独立 runner，实时状态不依赖网页开启或 Next.js 存活。

使用提交、开始、完成、错误事件更新任务，原始事件先持久化，处理重复、乱序与缺失。trace 提供最终任务状态与指标补账；运行退出后执行最终对账。插件不可用时明确显示观测降级，不通过时间推算任务进度，也不在运行中轮询被锁定的 `.nextflow/cache`。

任务身份使用 run ID、task ID、attempt；hash 是字段，不是数据库主键。新增 sessionId、nativeId、attempt、fullProcessName 等必要字段，metrics 缺失使用 null。导出时保存全限定 process name → node ID 映射，重复模块的别名必须区分，工具子流程任务允许归入系统任务。

总任务数在动态展开前可能未知，显示“已发现任务”而不是编造固定百分比；缓存命中、重试和最终失败分别计算。任务日志按服务端任务记录解析 workdir，不允许用户用 hash/path 任意读磁盘。处理日志半行、ANSI、编码和多次尝试。

验收：两个样本的 FastQC 分别显示真实任务，MultiQC 聚合为一个任务；错误、缓存与重试不会错绑节点；UI 与最终 trace 对账一致。

## 阶段 5：取消、恢复与进程异常

取消写入持久化意图，并进入 cancelling；排队和依赖准备阶段也能取消。执行阶段先向 Nextflow 发出温和终止信号，等待清理；超时后只升级处理当前运行拥有的进程组/容器。确认计算停止后才落 cancelled，不能只改数据库或执行全局 pkill。

普通新运行默认不加 resume。新增 resumeFromRunId，服务端确认源运行已结束、链锁可用、项目与输入身份一致、cache/work 存在，并使用明确的 Nextflow session ID。缺失缓存要解释后重新执行，不能宣称命中。

runner 重启时结合 PID、启动时间和运行身份核验；失去退出码时标记 interrupted/unknown，不能凭 PID 不存在断言成功。首版可选择终止核实归属的孤儿任务后允许用户 resume，不需要承诺无缝接管孤儿进程。

验收：取消长任务后没有遗留计算；从失败记录恢复时已完成的可缓存任务命中；Next.js 重启、runner 重启、主机重启三种情形有不同且真实的处理。

## 阶段 6：真实结果与前端闭环

结果索引实际 outdir 与 pipeline_info，返回真实文件大小、类型、节点归属；拆出 outputs.ts 中的共享 ResultFile 类型，模拟内容生成继续留在 mock 路径。保留失败运行已发布的部分产物。

预览限制文本大小，下载采用流式响应；验证 realpath，默认发布模式优先 copy，禁止结果符号链接越界。任务诊断文件走专门接口。HTML 默认使用无脚本 sandbox；需要完整交互的 MultiQC 提供下载，未来独立隔离源预览，不与应用同源放开脚本。

前端复用 React Query：在运行弹窗增加预检、数据路径验证与执行能力；仅显示可用执行器。新增准备阶段、取消中、失联、重新运行/从此处恢复；停轮询前最终刷新任务、日志和结果。可复用 UI 修改增加 Storybook 状态示例。

删除记录与清理数据分离：活动运行禁止删除，默认删除记录不销毁被其他尝试引用的 cache/work；清理提示影响的恢复能力并检查引用。

验收：网页可下载且文件内容与磁盘一致；MultiQC 报告包含实际样本；历史尝试不被后续日志与报告覆盖。

## 阶段 7：验证、交付与扩展

- 单元测试：状态机、幂等提交、组件锁、参数/路径校验、事件去重乱序、trace 字段解析、节点映射、恢复约束。
- 服务集成：临时数据库和真实子进程覆盖成功、失败、取消、重启、重复请求、准备阶段失败。
- Nextflow 集成：hello、单/双端质控、fastp 分支、小型 STAR、故意缺失输入、任务失败、取消和 resume；验证文件内容与缓存行为，不仅检查退出码。
- 浏览器验收：禁用 MSW，编辑 → 保存 → 预检 → 运行 → 实时日志 → 下载 → 取消 → resume → 重启后查询。
- PR 前执行 `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm build-storybook`。真实容器测试单独提供 `pnpm test:nextflow` 或 smoke 脚本，不让所有普通单元测试依赖 Docker/网络；交付说明明确哪些实际跑过。
- 文档补充安装、runner 启动、数据目录、环境变量、输入路径、依赖锁、诊断、取消、清理与迁移。运行数据、密钥、work 与缓存不入 Git。

建议分 PR：环境与 CLI smoke → 生成器/依赖/样本修复 → 存储与业务 API → runner 与队列 → 任务采集与真实日志 → 结果下载与前端 → 取消/恢复/异常恢复与端到端验收。取消能力至少提供基本版本后再让用户通过 UI 运行长任务。

首个可验证里程碑是 CLI 上生成项目完成 FastQC + MultiQC；第二个里程碑是浏览器完整提交与结果查看；最终第一版交付包含持久化、取消、明确来源的恢复与重启异常处理。SLURM、云 Batch、Kubernetes、多用户鉴权、大文件上传与远程 runner 在此后单独推进。

## 参考依据

- Nextflow 安装与 Java 范围：https://docs.seqera.io/nextflow/install
- Nextflow run 参数与 weblog 变更：https://docs.seqera.io/nextflow/reference/cli/run
- 缓存与恢复、LevelDB 限制：https://docs.seqera.io/nextflow/cache-and-resume
- 执行报告与指标限制：https://docs.seqera.io/nextflow/reports
- nf-weblog 插件事件协议：https://github.com/nextflow-io/nf-weblog
- 固定模块提交：https://nf-co.re/docs/nf-core-tools/cli/modules/install
- 子流程安装：https://nf-co.re/docs/nf-core-tools/cli/subworkflows/install
