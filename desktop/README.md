# Nextflow Studio 桌面版

Electron 外壳。服务端（界面、`/api`、笔记本内核和 Nextflow runner）可以跑在本机、WSL 或远程机器上，桌面端只负责连接它。

## 后端

| 连接 | 服务端在哪 | 说明 |
| ---- | ---- | ---- |
| 本机 | 这台电脑 | 下表的 web 和 runner 由主进程托管。macOS、Linux 首次启动默认用它；Windows 不提供（Nextflow 不支持 Windows） |
| WSL | WSL 发行版 | 首次连接时把 `resources/server/` 里的 Linux 服务端包装到 `~/.local/share/nextflow-studio/server/`，用 `wsl.exe` 启动 `nextflow-studio serve`。退出应用时停止 |
| SSH | 远程 Linux | 用系统的 `ssh`（需要免密登录）检查版本，必要时通过 ssh 传输并安装服务端包，在后台启动 `serve`，再建 `-L` 隧道。首次连接会记住主机密钥。退出应用只断开隧道，服务端继续运行，下次直接接上 |
| 地址 | 任意 | 连接已经在运行的服务端（见 [docs/server.md](../docs/server.md)），需要它的令牌。令牌用系统钥匙串加密保存 |

Windows 上没有 WSL 时，连接页的「安装 WSL」以管理员身份运行 `wsl --install`（弹出 UAC），之后按提示创建 Linux 用户，必要时重启。连上后缺少 Java 或 Nextflow 时，设置页自动依次安装，runner 每 30 秒重试，装好后自动就绪。

启动时不用选后端：应用直接启动上次的后端（第一次是默认后端：Windows 上是第一个 WSL 发行版，macOS、Linux 上是本机），窗口先显示随应用打包的启动画面（`src/connect/index.html`），服务端就绪后进入首页。只有启动失败时，这一页才显示错误和「重试」「重新安装服务端」「换一个后端」。

后端在首页左下角的「后端环境」里管理（File 菜单的「后端环境…」打开同一个窗口）：

| 操作 | 做什么 |
| ---- | ---- |
| 重启 | 停掉服务端（SSH 的也真的停掉）再启动 |
| 重新安装服务端 | 用应用自带的包覆盖安装后重启。开发版这里是「用当前代码重新构建」：Windows 上在 WSL 里跑 `scripts/wsl-bootstrap.sh`（同 `pnpm dev:win`），macOS / Linux 跑 `scripts/bundle.mjs` |
| 清除数据 | 停掉服务端，删掉数据库、示例项目、运行记录、启动目录和 `work/`，再启动。设置（`settings.json`、`secrets.json`）、工具链、日志和自己文件夹里的项目保留 |
| 切换 | 已保存的后端和新建 WSL / SSH / 地址连接。同一个发行版、主机或地址只保存一条 |

连接保存在 userData 的 `connections.json`。服务端包、`server.json`、启动时打印的 ready 行和 `/api/health` 都带构建号（`BUILD`）：已经在运行的服务端不是刚装好的那个构建时，会先停掉再启动，不会被直接复用；连上后的构建号和包不一致时报错，不会显示旧界面。

文件只归服务端管，所有后端都一样（参考 ComfyUI 的 `input/`）：笔记本和流程用的文件放在当前工作区（项目文件夹），拖入、粘贴或点上传，文件进入工作区的 `data/`；数据输入的选择器只浏览工作区，配置路径（Python、Java、私钥、项目位置）浏览服务端。桌面端不读取本机路径，也不打开本机文件。

## 本机后端

主进程托管三样东西，崩溃时按退避自动重启：

| 进程 | 来源 | 说明 |
| ---- | ---- | ---- |
| web | `.next/standalone/server.js` | 界面和 `/api`，也负责笔记本的 Jupyter 内核。只监听 `127.0.0.1` 的随机端口，每次启动生成会话令牌，窗口带 cookie 访问，`src/proxy.ts` 拒绝没有令牌或 Host 不是回环地址的请求 |
| runner | `scripts/runner.ts` → `resources/runner/runner.mjs` | 排队、启动和监视 Nextflow |
| 窗口 / 菜单栏 | `desktop/src/main.ts` | 系统通知、菜单栏显示运行数 |

Nextflow head 在独立进程组里运行。关窗口时有运行中的流程，应用留在菜单栏继续发通知；退出时会问「后台继续 / 停止运行并退出」。选后台继续时 Nextflow 照常跑完，下次打开应用由新的 runner 接管。

macOS 上的 GUI 应用拿不到 shell 的 `PATH`，启动时会从登录 shell 读取 `PATH`、`JAVA_HOME`、conda 和代理等变量。

## 构建

```bash
pnpm install                         # 仓库根目录：web 应用依赖
pnpm --dir desktop install           # 桌面外壳依赖（Electron 只装在这里）
pnpm --dir desktop bundle            # standalone 服务、runner、Linux 服务端包、main/preload、连接页，预取 nf-weblog
pnpm --dir desktop start             # mac / Linux：用当前代码重建本机服务端和外壳，再打开；Windows 上等于 dev:win
pnpm --dir desktop dev               # 先重新打包外壳（main / preload / 启动页）再打开，沿用 resources/ 里上次的服务端；Windows 上等于 dev:win
pnpm --dir desktop dist:mac          # 未签名的 .dmg / .zip（arm64 + x64）
pnpm --dir desktop dist:linux        # AppImage
pnpm --dir desktop exec electron-builder --win   # Windows NSIS 安装包（只含连接 WSL / SSH / 地址所需的部分）
```

打包的应用每次构建都有自己的构建号（`resources/app-server.build`），版本号不变也会重新解压服务端，不会继续用 userData 里上一次解压的旧服务端。本机数据库的格式版本和当前代码不同时（没有迁移），启动本机服务端前会清掉数据库、示例项目、运行记录和工作目录；设置、工具链和放在自己文件夹里的项目保留。

### Windows 开发

```powershell
cd desktop
pnpm install
pnpm dev:win              # 每次都在 WSL 里用当前代码构建服务端，再启动 Electron
pnpm dev:win --fresh      # 另外清空 WSL 里的数据目录（toolchain/ 和已装的服务端保留）
pnpm dev:win --skip-server  # 只重打包外壳，沿用 resources/server 里上次的服务端包
```

`dev:win` 在 WSL 里构建服务端，WSL 里不需要预先装任何东西，也不读取 `.bashrc`、`.profile` 等 shell 配置（它们可能启动 conda、ssh-agent 或等待输入，让构建卡住）。`scripts/wsl-bootstrap.sh` 用 `/bin/sh` 运行，把构建要用的东西装进我们自己的目录 `~/.local/share/nextflow-studio/toolchain/build/`：服务端包自带的同一版 Node.js（从 nodejs.org 下载并校验 SHA-256；没有 curl、wget 和 python3 时，在不需要密码的情况下先装 curl），以及 package.json 指定版本的 pnpm（用这个 Node 的 npm 安装）。然后用这个 Node 运行 `scripts/dev-server-build.mjs`，分 6 步并逐步输出：准备 pnpm → 把仓库同步到 `~/.cache/nextflow-studio/dev-src`（只复制改动的文件，那里的 node_modules 和 .next 保留，之后是增量构建；不需要 rsync）→ 安装依赖 → 构建 Linux 服务端包 → 停掉 WSL 里正在运行的服务端（数据格式版本和当前代码不同时清除数据）→ 把包放进 `desktop/resources/server/`。长时间没有输出的步骤每 30 秒报一次进度，超过时限会停止并给出日志位置（WSL 里的 `~/.local/share/nextflow-studio/logs/dev-build.log`）。每个包有自己的构建号，所以连接 WSL 或 SSH 时会装上它，而不是继续用旧的。`NEXTFLOW_STUDIO_WSL_DISTRO` 指定发行版，`NEXTFLOW_STUDIO_NODE_MIRROR` 指定 Node.js 下载镜像。

开发版（未打包）连接 WSL 或 SSH 时，没有服务端包会直接报错，不会悄悄沿用之前装的服务端。每次连接都会清掉窗口的 HTTP 缓存和 service worker。

`bundle --server-arm64` 额外打包 linux-arm64 服务端（ARM 服务器、ARM 版 Windows 的 WSL）。`bundle --skip-server` 跳过服务端包。

`bundle` 会用 `nextflow plugin install nf-weblog@1.2.0` 把插件解到 `resources/plugins/`，打进安装包；首次启动时复制到数据目录的 `toolchain/plugins/`，离线也有实时进度。构建机连不上插件仓库时只打印警告，应用首次启动再装；都装不上时 runner 改为每 3 秒读 trace 文件。

## 签名、公证和自动更新

见仓库的 `.github/workflows/desktop.yml`。打 `desktop-v*` 标签时在 macOS 和 Linux 上构建；配置了下面的 secrets 就签名并公证，否则产出未签名的内测包：

- `CSC_LINK`、`CSC_KEY_PASSWORD`：Developer ID Application 证书（base64 的 .p12）
- `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`：公证

自动更新用 `electron-updater` 读 GitHub Releases。工具链（JRE、Nextflow、nf-weblog、micromamba）装在数据目录下按版本分目录，不随应用更新替换。设 `NEXTFLOW_STUDIO_DISABLE_UPDATES=1` 关闭检查。
