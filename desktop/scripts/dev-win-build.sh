#!/bin/sh
# Run by desktop/scripts/dev-win.mjs inside WSL: builds the server package from the Windows checkout ($1, a Windows
# path), stops the running server, clears an incompatible data directory (or any, with $2 = 1), and copies the
# package to desktop/resources/server. The whole script is one function, so sh has read all of it from stdin before
# anything runs, and no command can swallow the rest of it.
main() {
  set -e
  src=$(wslpath -u "$1")
  fresh="$2"
  work="$HOME/.cache/nextflow-studio/dev-src"
  data="${XDG_DATA_HOME:-$HOME/.local/share}/nextflow-studio"
  fail() { echo "dev:win: $*" >&2; exit 3; }

  # nvm and fnm set up node in ~/.bashrc, which a login sh does not read.
  [ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true
  command -v node >/dev/null 2>&1 || fail "WSL 里没有 node。装 Node 22.5 以上（例如 nvm install 22）后重试"
  node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 5) ? 0 : 1)' \
    || fail "WSL 里的 node $(node -v) 太旧，需要 22.5 以上"
  command -v rsync >/dev/null 2>&1 || fail "WSL 里没有 rsync：sudo apt install rsync"
  case "$(uname -m)" in x86_64|amd64) arch=x64 ;; aarch64|arm64) arch=arm64 ;; *) fail "不支持的架构 $(uname -m)" ;; esac

  echo "== 同步源码到 WSL：$work"
  mkdir -p "$work"
  rsync -a --delete \
    --exclude=/.git --exclude=/node_modules --exclude=/.next --exclude=/dist-server --exclude=/.codegraph \
    --exclude=/storybook-static --exclude=/test-results --exclude=/playwright-report --exclude='/nxf-tmp.*' \
    --exclude=/desktop/node_modules --exclude=/desktop/dist --exclude=/desktop/resources --exclude=/desktop/release \
    "$src/" "$work/"
  cd "$work"

  echo "== 安装依赖并构建服务端（linux-$arch）"
  if command -v corepack >/dev/null 2>&1; then pnpm() { corepack pnpm "$@"; }; fi
  pnpm install --frozen-lockfile
  rm -rf dist-server
  node scripts/build-server.mjs --arch "$arch"
  pkg=$(cd dist-server && ls nextflow-studio-server-*-linux-"$arch".tar.gz | head -n 1)
  [ -n "$pkg" ] || fail "没有生成服务端包"
  name=${pkg%.tar.gz}

  echo "== 停止 WSL 里正在运行的服务端"
  p=$(sed -n 's/.*"pid": *\([0-9][0-9]*\).*/\1/p' "$data/server.json" 2>/dev/null || true)
  if [ -n "$p" ] && kill -0 "$p" 2>/dev/null; then
    kill -TERM "$p"
    i=0
    while kill -0 "$p" 2>/dev/null && [ $i -lt 20 ]; do sleep 1; i=$((i + 1)); done
  fi

  want=$(sed -n 's/^export const SCHEMA_VERSION = \([0-9][0-9]*\);/\1/p' src/lib/server/schema.ts)
  have=
  if [ -f "$data/studio.sqlite" ]; then
    have=$(node --no-warnings --experimental-sqlite -e 'const { DatabaseSync } = require("node:sqlite"); const db = new DatabaseSync(process.argv[1], { readOnly: true }); console.log(db.prepare("PRAGMA user_version").get().user_version)' "$data/studio.sqlite" 2>/dev/null || echo unreadable)
  fi
  if [ "$fresh" = 1 ] || { [ -n "$have" ] && [ "$have" != "$want" ]; }; then
    echo "== 清空数据目录 $data（数据格式 ${have:-无} → $want；保留 toolchain/ 和 server/）"
    find "$data" -mindepth 1 -maxdepth 1 ! -name toolchain ! -name server -exec rm -rf {} +
  fi

  out="$src/desktop/resources/server"
  mkdir -p "$out"
  rm -f "$out"/nextflow-studio-server-*
  cp "dist-server/$pkg" "dist-server/$name.build" "$out/"
  echo "== 服务端包：$out/$pkg（构建 $(cat "dist-server/$name.build")）"
}
main "$@" </dev/null
