# 独立服务端

`nextflow-studio serve` 在存放数据的那台机器上同时运行 web 服务（界面、`/api`、笔记本内核）和 Nextflow runner。浏览器和桌面端都只是连接它的客户端。适用于 WSL2、实验室服务器，或任何一台装了 Java 的 Linux 机器。

## 构建

```bash
pnpm build-server                       # dist-server/nextflow-studio-server-<版本>-linux-x64.tar.gz
pnpm build-server --arch arm64
pnpm build-server --skip-next           # 复用上一次的 Next.js standalone 构建
pnpm build-server --no-node             # 不打包 Node，目标机器需要 Node >= 22.5
```

包内自带 Node 运行时（从 nodejs.org 下载并校验 SHA-256，走 `HTTPS_PROXY`）。目标机器只需要 Java 17+ 来运行 Nextflow，缺少的工具可以在设置页安装。

## 运行

```bash
tar -xzf nextflow-studio-server-<版本>-linux-x64.tar.gz
./nextflow-studio-server-<版本>-linux-x64/bin/nextflow-studio serve
```

启动后 stdout 先输出一行 JSON 供启动器解析，再输出一个打开即登录的链接：

```
{"event":"ready","host":"127.0.0.1","port":41237,"token":"…","version":"0.2.1","apiVersion":1,"pid":1234,"reused":false}
Nextflow Studio 0.2.1 已启动：http://127.0.0.1:41237/?token=…
```

日志写到 stderr，以及 `<数据目录>/logs/web.log` 和 `runner.log`。

| 选项 | 默认值 | 说明 |
|---|---|---|
| `--host` | `127.0.0.1` | 监听地址 |
| `--port` | `0`（自动） | 端口 |
| `--token` | `<数据目录>/server-token` | 会话令牌，首次启动时生成（权限 0600） |
| `--data-dir` | `~/.local/share/nextflow-studio` | 数据目录，也可用 `NEXTFLOW_STUDIO_DATA_DIR` |
| `--allowed-hosts` | 无 | 额外接受的 Host 名称，逗号分隔 |

同一个数据目录已经有服务在运行时，`serve` 只会输出该服务的 ready 行（`"reused":true`），然后退出。运行中的服务记录在 `<数据目录>/server.json`。

## 访问方式

- **WSL2**：WSL2 默认把 localhost 转发到 Windows，在 Windows 浏览器里直接打开上面的链接即可。
- **服务器**：保持默认的 `127.0.0.1`，通过 SSH 隧道访问：

  ```bash
  ssh -N -L 8765:127.0.0.1:41237 user@server
  # 浏览器打开 http://127.0.0.1:8765/?token=…
  ```

  隧道另一端的端口可以不同，服务端不校验回环地址的端口。
- **直接暴露在内网**（不推荐）：`--host 0.0.0.0 --allowed-hosts server.lab.example`。流量没有加密，令牌会明文传输，至少应放在 HTTPS 反向代理后面。

## 安全

- 所有请求都必须带会话令牌：浏览器通过 `?token=` 链接拿到的 httpOnly cookie，或请求头 `x-studio-session`。不带令牌返回 403，Host 不在允许列表里返回 421（防 DNS rebinding）。
- 拖入或粘贴的文件通过 `PUT /api/fs/upload` 流式写入项目的 `data/` 目录，单个文件默认上限 50 GB（可用 `NEXTFLOW_STUDIO_UPLOAD_MAX_BYTES` 修改）。这个接口绕过了 Next.js proxy（proxy 会把请求体缓存在内存里），由路由自己做同样的会话检查。
- 设置页保存的 API key 在服务端以 0600 权限的文件保存；没有桌面端的钥匙串时不加密。
