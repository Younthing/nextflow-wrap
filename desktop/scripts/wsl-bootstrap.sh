#!/bin/sh
# The WSL half of `pnpm dev:win` and of "用当前代码重新构建" in the app. dev-win.mjs (or the app) pipes this file to
# `wsl.exe --exec /bin/sh -s -- <checkout as a Windows path> [--fresh]`.
#
# It depends on nothing the person set up in WSL: no shell rc files are read (they can start agents, prompts or
# conda and hang a non-interactive run), and no node, pnpm or rsync of theirs is used. What the build needs is
# installed once into our own folder, ~/.local/share/nextflow-studio/toolchain/build/:
#   node-<version>-linux-<arch>/   the Node.js release the server package ships (scripts/build-server.mjs),
#                                  checked against nodejs.org's SHA-256 list
#   pnpm-<version>/, bin/pnpm      pnpm at package.json's packageManager version, installed with that Node's npm
# and the rest of the build runs in desktop/scripts/dev-server-build.mjs with that Node.
#
# The whole script is one function, so sh has read all of it from stdin before anything runs.
main() {
  set -eu
  say() { printf '== %s\n' "$*"; }
  fail() { printf 'dev:win: %s\n' "$*" >&2; exit 3; }

  [ $# -ge 1 ] || fail "缺少源码目录参数"
  case "$1" in
    /*) src="$1" ;;
    *) src=$(wslpath -u "$1") || fail "无法转换路径 $1" ;;
  esac
  shift
  [ -f "$src/scripts/build-server.mjs" ] || fail "$src 不是 nextflow-wrap 仓库"

  case "$(uname -m)" in
    x86_64|amd64) arch=x64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) fail "不支持的架构 $(uname -m)" ;;
  esac
  version=$(sed -n 's/^const NODE_VERSION = "\(v[0-9.]*\)";.*/\1/p' "$src/scripts/build-server.mjs" | tr -d '\r')
  [ -n "$version" ] || fail "scripts/build-server.mjs 里没有 NODE_VERSION"

  data="${XDG_DATA_HOME:-$HOME/.local/share}/nextflow-studio"
  tools="$data/toolchain/build"
  name="node-$version-linux-$arch"
  node_dir="$tools/$name"
  mirror="${NEXTFLOW_STUDIO_NODE_MIRROR:-https://nodejs.org/dist}"

  # Downloads $1 to $2 with whatever this distro has; curl and wget are on stock Ubuntu, python3 nearly always.
  fetch() {
    if command -v curl >/dev/null 2>&1; then
      curl -fsSL --retry 3 --connect-timeout 20 --max-time 900 -o "$2" "$1"
    elif command -v wget >/dev/null 2>&1; then
      wget -q --tries=3 --timeout=20 -O "$2" "$1"
    elif command -v python3 >/dev/null 2>&1; then
      python3 -c 'import sys, urllib.request; urllib.request.urlretrieve(sys.argv[1], sys.argv[2])' "$1" "$2"
    else
      return 127
    fi
  }

  if [ ! -x "$node_dir/bin/node" ]; then
    say "安装构建用的 Node.js $version 到 $tools（只装一次）"
    if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1 && ! command -v python3 >/dev/null 2>&1; then
      # Nothing to download with: install curl when that needs no password (root, or sudo without one).
      say "WSL 里没有 curl，正在安装"
      if [ "$(id -u)" = 0 ]; then apt-get update -qq && apt-get install -y -qq curl ca-certificates >/dev/null
      elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then sudo -n apt-get update -qq && sudo -n apt-get install -y -qq curl ca-certificates >/dev/null
      else fail "WSL 里没有 curl、wget 或 python3，且安装需要密码。在 WSL 里运行 sudo apt install curl 后重试"
      fi
    fi
    mkdir -p "$tools"
    tmp="$tools/.download-$$"
    rm -rf "$tmp"
    mkdir -p "$tmp"
    fetch "$mirror/$version/SHASUMS256.txt" "$tmp/SHASUMS256.txt" || { rm -rf "$tmp"; fail "下载 $mirror/$version/SHASUMS256.txt 失败，检查 WSL 能否访问 nodejs.org（或设置 NEXTFLOW_STUDIO_NODE_MIRROR）"; }
    fetch "$mirror/$version/$name.tar.gz" "$tmp/$name.tar.gz" || { rm -rf "$tmp"; fail "下载 $name.tar.gz 失败"; }
    expected=$(grep " $name.tar.gz\$" "$tmp/SHASUMS256.txt" | cut -d' ' -f1)
    actual=$(sha256sum "$tmp/$name.tar.gz" | cut -d' ' -f1)
    if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then rm -rf "$tmp"; fail "下载的 Node.js 校验失败"; fi
    tar -xzf "$tmp/$name.tar.gz" -C "$tmp"
    rm -rf "$node_dir"
    mv "$tmp/$name" "$node_dir"
    rm -rf "$tmp"
  fi
  "$node_dir/bin/node" -e '' 2>/dev/null || fail "$node_dir/bin/node 无法运行；删除 $tools 后重试"
  say "Node.js $version：$node_dir/bin/node"

  exec "$node_dir/bin/node" "$src/desktop/scripts/dev-server-build.mjs" --src "$src" --tools "$tools" --node-dir "$node_dir" --arch "$arch" "$@"
}
main "$@" </dev/null
