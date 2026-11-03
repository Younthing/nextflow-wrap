#!/bin/sh
# Finding a Node.js new enough to build the server in WSL (sourced ahead of dev-win-build.sh; also tested by
# src/features/desktop/wsl-node.test.ts). People install Node in many ways, and most of them only set PATH in
# ~/.bashrc or ~/.zshrc, which the non-interactive login sh that runs the build never reads. So every usual place
# is looked at and the newest Node that is new enough wins; without one, the official release is downloaded once
# into ~/.cache/nextflow-studio (no root needed), checked against its published SHA-256.

# Minimum version: node:sqlite.
NODE_MIN_MAJOR=22
NODE_MIN_MINOR=5

# Whether $1 runs and is new enough.
node_ok() {
  [ -n "$1" ] && [ -x "$1" ] || return 1
  "$1" -e "const [a, b] = process.versions.node.split('.').map(Number); process.exit(a > $NODE_MIN_MAJOR || (a === $NODE_MIN_MAJOR && b >= $NODE_MIN_MINOR) ? 0 : 1)" >/dev/null 2>&1
}

# Every node on this machine that a person might mean, one path per line (duplicates and missing ones included).
node_candidates() {
  command -v node 2>/dev/null || true
  # What the person's own terminal would run: nvm, fnm, volta, asdf and mise set PATH in the interactive rc files.
  for rc_shell in bash zsh; do
    command -v "$rc_shell" >/dev/null 2>&1 || continue
    if command -v timeout >/dev/null 2>&1; then
      timeout 20 "$rc_shell" -ic 'command -v node' </dev/null 2>/dev/null | tail -n 1 || true
    else
      "$rc_shell" -ic 'command -v node' </dev/null 2>/dev/null | tail -n 1 || true
    fi
  done
  for pattern in \
    "${NVM_DIR:-$HOME/.nvm}/versions/node/*/bin/node" \
    "$HOME/.local/share/fnm/node-versions/*/installation/bin/node" \
    "$HOME/.fnm/node-versions/*/installation/bin/node" \
    "$HOME/.volta/tools/image/node/*/bin/node" \
    "$HOME/.asdf/installs/nodejs/*/bin/node" \
    "$HOME/.local/share/mise/installs/node/*/bin/node" \
    "$HOME/.nodenv/versions/*/bin/node" \
    "$HOME/n/bin/node" \
    "/usr/local/n/versions/node/*/bin/node" \
    "/usr/local/bin/node" \
    "/usr/bin/node" \
    "/snap/bin/node" \
    "/opt/node*/bin/node" \
    "$HOME/.cache/nextflow-studio/node-*/bin/node"; do
    # Unquoted on purpose: the pattern is expanded here; a pattern that matches nothing stays literal and is skipped.
    for path in $pattern; do [ -e "$path" ] && printf '%s\n' "$path"; done
  done
}

# Prints the newest usable node, or nothing.
find_node() {
  node_candidates | while IFS= read -r candidate; do
    if node_ok "$candidate"; then printf '%s %s\n' "$("$candidate" -p 'process.versions.node')" "$candidate"; fi
  done | sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1 | cut -d' ' -f2-
}

# Downloads the official Node.js release $1 (e.g. v24.7.0) for arch $2 (x64, arm64) into the cache, checks its
# SHA-256 and prints the path of its node. Uses curl or wget, whichever exists.
download_node() {
  version="$1"
  node_arch="$2"
  name="node-$version-linux-$node_arch"
  dir="$HOME/.cache/nextflow-studio/$name"
  if node_ok "$dir/bin/node"; then printf '%s\n' "$dir/bin/node"; return 0; fi
  tmp="$dir.download.$$"
  rm -rf "$tmp"
  mkdir -p "$tmp"
  base="https://nodejs.org/dist/$version"
  fetch() {
    if command -v curl >/dev/null 2>&1; then curl -fsSL --retry 3 -o "$2" "$1"
    elif command -v wget >/dev/null 2>&1; then wget -q -O "$2" "$1"
    else echo "WSL 里没有 curl 或 wget，无法下载 Node.js" >&2; return 1
    fi
  }
  echo "== WSL 里没有 22.5 以上的 Node.js，下载 $name（只放在 ~/.cache/nextflow-studio，不影响系统）" >&2
  fetch "$base/$name.tar.gz" "$tmp/$name.tar.gz" || { rm -rf "$tmp"; return 1; }
  fetch "$base/SHASUMS256.txt" "$tmp/SHASUMS256.txt" || { rm -rf "$tmp"; return 1; }
  expected=$(grep " $name.tar.gz\$" "$tmp/SHASUMS256.txt" | cut -d' ' -f1)
  actual=$(sha256sum "$tmp/$name.tar.gz" | cut -d' ' -f1)
  if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
    echo "下载的 Node.js 校验失败" >&2
    rm -rf "$tmp"
    return 1
  fi
  tar -xzf "$tmp/$name.tar.gz" -C "$tmp"
  rm -rf "$dir"
  mv "$tmp/$name" "$dir"
  rm -rf "$tmp"
  printf '%s\n' "$dir/bin/node"
}
