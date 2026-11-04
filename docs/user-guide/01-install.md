# 安装和首次启动

## 下载

在 [Releases](https://github.com/Younthing/nextflow-wrap/releases) 下载对应系统的安装包：

| 系统 | 文件 |
| --- | --- |
| Windows x64 | `.exe` 安装程序（NSIS）；运行工作流需连接 WSL 或远程 Linux |
| macOS（Apple 芯片） | 文件名带 `arm64` 的 `.dmg` |
| macOS（Intel） | 文件名带 `x64` 的 `.dmg` |
| Linux x64 | `.AppImage`（`chmod +x` 后双击或在终端运行） |

测试版如果没有签名，macOS 第一次打开时请在 Finder 里右键应用 → 打开。之后应用会在后台检查并下载新版本，下载完成后提示重启；选「稍后」则在下次退出时安装。

## 首次启动向导

第一次打开会进入「运行环境」页面，逐项检查：

| 工具 | 必需 | 没有时 |
| --- | --- | --- |
| Java 17–26 | 是 | 点「下载 Temurin JRE」，装到应用自己的数据目录，不改动系统 |
| Nextflow | 是 | 点「下载 Nextflow」，版本固定为应用测试过的版本 |
| nf-weblog 插件 | 否 | 安装包里已经带了；缺失时运行进度改为每几秒读取 trace 文件 |
| conda / mamba | 否 | 点「安装 micromamba」；只有选 conda / mamba profile 运行时需要 |
| Jupyter 内核 | 否 | 点「创建笔记本环境」，装好 Python、ipykernel、scanpy、RDKit 和 Vina |
| Docker | 否 | 需要容器时自行安装 Docker Desktop |

已经装在系统里的 Java、Nextflow、conda 和 Jupyter 会被直接使用，向导显示「系统」。
所有下载都核对 SHA-256，安装日志在设置 → 诊断导出的诊断包里。

## 配置 Nextflow 执行环境

「设置 → 偏好 → Nextflow 执行环境」中的「Nextflow 版本」可以选择：

- **最新稳定版**：每次新运行、模块试跑和运行环境检查时，查询官方最新稳定版并解析为具体版本号。首次使用需要联网下载；下载会校验官方 SHA-256，查询或校验失败会明确报错。
- **指定版本**：填写完整版本号，例如 `26.10.4`；已有匹配版本可离线使用。未设置时使用应用内置的 `26.10.4`。模块试跑需要 26.04 或更高版本。

保存后重启 Runner。运行详情和该次运行的 `manifest.json` 会记录实际版本；续跑沿用来源运行记录的版本。模块试跑也保存实际版本。也可通过 `NEXTFLOW_STUDIO_NEXTFLOW_VERSION=latest` 或具体版本号配置，该环境变量优先于设置页。此选项适用于当前执行主机（包括 WSL/SSH 服务端）；独立远程集群仍使用该集群自己的 Nextflow 配置。

在「设置 → 偏好 → Nextflow 执行环境」填写「Nextflow 启动前命令（Bash）」，例如使用已有的 `bia-main` Conda 环境：

```bash
source "$HOME/miniconda3/etc/profile.d/conda.sh"
conda activate bia-main
```

将 `conda.sh` 路径替换为执行主机上实际的 Conda 安装位置。不要写成 `bash conda activate bia-main`；需要先加载 Conda 的 shell 初始化脚本，再在同一个 shell 中激活环境。

保存后重启 Runner。运行环境检查时会先执行这些命令，以便找到激活后的 Java、Nextflow 和运行工具；每次工作流启动或 Nextflow 模块试跑时，也会在 Bash 中执行命令后启动 Nextflow。命令输出进入运行日志，失败则停止启动。支持多行命令，留空恢复原环境；不会自动加载 `.bashrc` 或登录 shell 配置，需要的初始化请显式写入。

macOS/Linux 在当前执行主机运行；Windows 桌面连接 WSL/SSH 服务端时，在对应服务端的设置页填写该主机的路径和命令。运行提交到独立远程集群时，使用该集群设置中的「登录后执行」。也可通过 `NEXTFLOW_STUDIO_NEXTFLOW_SETUP` 环境变量配置，它优先于设置页。

此设置改变 Nextflow 和本机 shell 任务继承的环境；`conda` profile 和容器中的任务仍使用模块声明的环境。笔记本 Python 内核继续使用「笔记本用的 Python」配置。

## 数据放在哪里

| 系统 | 目录 |
| --- | --- |
| macOS | `~/Library/Application Support/Nextflow Studio` |
| Linux | `$XDG_DATA_HOME/nextflow-studio`，默认 `~/.local/share/nextflow-studio` |

可以用环境变量 `NEXTFLOW_STUDIO_DATA_DIR` 换到别的磁盘。升级应用时，旧数据会自动升级，升级前的数据库副本放在 `backups/`。
用旧版本应用打开新版本写过的数据会被拒绝，而不是读错，所以降级不会丢数据。

## 关窗和退出

关闭窗口时如果还有运行在跑，应用会留在菜单栏（Linux 托盘）继续运行，图标上显示运行数。
退出时如果还有运行，会问你：后台继续（下次打开仍能看到进度）、停止并退出、或取消。
