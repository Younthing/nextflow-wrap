# 安装和首次启动

## 下载

在 [Releases](https://github.com/Younthing/nextflow-wrap/releases) 下载对应系统的安装包：

| 系统 | 文件 |
| --- | --- |
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
