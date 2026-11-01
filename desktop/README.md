# Nextflow Studio 桌面版

Electron 外壳，复用同一份 Next.js 应用和 Nextflow runner。主进程托管三样东西，崩溃时按退避自动重启：

| 进程 | 来源 | 说明 |
| ---- | ---- | ---- |
| web | `.next/standalone/server.js` | 界面和 `/api`，也负责笔记本的 Jupyter 内核。只监听 `127.0.0.1` 的随机端口，每次启动生成会话令牌，窗口带 cookie 访问，`src/proxy.ts` 拒绝没有令牌或 Host 不是回环地址的请求 |
| runner | `scripts/runner.ts` → `resources/runner/runner.mjs` | 排队、启动和监视 Nextflow |
| 窗口 / 菜单栏 | `desktop/src/main.ts` | 原生文件对话框、拖入文件取路径、「在 Finder 中显示」、系统通知、菜单栏显示运行数 |

Nextflow head 在独立进程组里运行。关窗口时有运行中的流程，应用留在菜单栏继续发通知；退出时会问「后台继续 / 停止运行并退出」。选后台继续时 Nextflow 照常跑完，下次打开应用由新的 runner 接管。

macOS 上的 GUI 应用拿不到 shell 的 `PATH`，启动时会从登录 shell 读取 `PATH`、`JAVA_HOME`、conda 和代理等变量。

## 构建

```bash
pnpm install                         # 仓库根目录：web 应用依赖
pnpm --dir desktop install           # 桌面外壳依赖（Electron 只装在这里）
pnpm --dir desktop bundle            # standalone 服务、runner、main/preload，预取 nf-weblog
pnpm --dir desktop dev               # 用本地 Electron 打开（不打包）
pnpm --dir desktop dist:mac          # 未签名的 .dmg / .zip（arm64 + x64）
pnpm --dir desktop dist:linux        # AppImage
```

`bundle` 会用 `nextflow plugin install nf-weblog@1.2.0` 把插件解到 `resources/plugins/`，打进安装包；首次启动时复制到数据目录的 `toolchain/plugins/`，离线也有实时进度。构建机连不上插件仓库时只打印警告，应用首次启动再装；都装不上时 runner 改为每 3 秒读 trace 文件。

## 签名、公证和自动更新

见仓库的 `.github/workflows/desktop.yml`。打 `desktop-v*` 标签时在 macOS 和 Linux 上构建；配置了下面的 secrets 就签名并公证，否则产出未签名的内测包：

- `CSC_LINK`、`CSC_KEY_PASSWORD`：Developer ID Application 证书（base64 的 .p12）
- `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`：公证

自动更新用 `electron-updater` 读 GitHub Releases。工具链（JRE、Nextflow、nf-weblog、micromamba）装在数据目录下按版本分目录，不随应用更新替换。设 `NEXTFLOW_STUDIO_DISABLE_UPDATES=1` 关闭检查。
