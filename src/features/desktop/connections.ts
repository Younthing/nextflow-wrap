/**
 * Where the desktop app finds its server. `local` runs the bundled server on this computer (not on Windows, where
 * Nextflow does not run); `wsl` installs and starts the Linux server package in a WSL distro; `ssh` does the same
 * on a remote machine and reaches it through a tunnel; `url` attaches to a server someone already runs.
 */
export type Connection =
  | { id: string; kind: "local"; label: string }
  | { id: string; kind: "wsl"; label: string; distro: string }
  | { id: string; kind: "ssh"; label: string; target: string; port?: number; identityFile?: string }
  | { id: string; kind: "url"; label: string; url: string };

export type ConnectionKind = Connection["kind"];

export interface ConnectionStore {
  last?: string;
  connections: Connection[];
}

export class ConnectionError extends Error {}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
/** An ssh destination: `host`, `user@host`, or a ~/.ssh/config alias. Never starts with `-`. */
const SSH_TARGET = /^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9][A-Za-z0-9._-]*$/;
const DISTRO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const text = (value: unknown, max = 200) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/** Checks a connection sent from the connect page (untrusted IPC input). */
export function readConnection(input: unknown): Connection {
  const value = (input ?? {}) as Record<string, unknown>;
  const id = text(value.id, 64);
  if (!ID.test(id)) throw new ConnectionError("连接 id 无效");
  const kind = value.kind;
  if (kind === "local") return { id, kind, label: text(value.label) || "本机" };
  if (kind === "wsl") {
    const distro = text(value.distro, 64);
    if (!DISTRO.test(distro)) throw new ConnectionError("WSL 发行版名称无效");
    return { id, kind, distro, label: text(value.label) || `WSL · ${distro}` };
  }
  if (kind === "ssh") {
    const target = text(value.target);
    if (!SSH_TARGET.test(target)) throw new ConnectionError("SSH 目标应为 主机、用户@主机 或 ~/.ssh/config 里的别名");
    const port = value.port === undefined || value.port === "" || value.port === null ? undefined : Number(value.port);
    if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) throw new ConnectionError("SSH 端口无效");
    const identityFile = text(value.identityFile, 1000) || undefined;
    if (identityFile?.startsWith("-")) throw new ConnectionError("私钥路径无效");
    return { id, kind, target, label: text(value.label) || target, ...(port ? { port } : {}), ...(identityFile ? { identityFile } : {}) };
  }
  if (kind === "url") {
    let url: URL;
    try { url = new URL(text(value.url, 500)); } catch { throw new ConnectionError("地址无效"); }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new ConnectionError("地址需以 http:// 或 https:// 开头");
    return { id, kind, url: url.origin, label: text(value.label) || url.host };
  }
  throw new ConnectionError("未知的连接类型");
}

/** What a connection points at: two entries with the same key are the same backend, whatever their ids. */
export function connectionKey(connection: Connection): string {
  switch (connection.kind) {
    case "local": return "local";
    case "wsl": return `wsl:${connection.distro.toLowerCase()}`;
    case "ssh": return `ssh:${connection.target}:${connection.port ?? 22}`;
    case "url": return `url:${connection.url}`;
  }
}

/** One line under a connection's label: the distro, ssh target or address. */
export function connectionDetail(connection: Connection): string {
  switch (connection.kind) {
    case "local": return "这台电脑";
    case "wsl": return `WSL · ${connection.distro}`;
    case "ssh": return `ssh ${connection.target}${connection.port ? `:${connection.port}` : ""}`;
    case "url": return connection.url;
  }
}

export const wslConnection = (distro: string): Connection => ({ id: `wsl-${distro.toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 60)}`, kind: "wsl", distro, label: `WSL · ${distro}` });
export const LOCAL_CONNECTION: Connection = { id: "local", kind: "local", label: "本机" };

export function readStore(input: unknown): ConnectionStore {
  const value = (input ?? {}) as Record<string, unknown>;
  const connections: Connection[] = [];
  for (const item of Array.isArray(value.connections) ? value.connections : []) {
    try {
      const connection = readConnection(item);
      // Older shells saved a new entry for every connect: keep the first (most recent) per backend.
      if (!connections.some((known) => known.id === connection.id || connectionKey(known) === connectionKey(connection))) connections.push(connection);
    } catch { /* Dropped: an entry from a newer or hand-edited file. */ }
  }
  const last = typeof value.last === "string" && connections.some((item) => item.id === value.last) ? value.last : undefined;
  return { last, connections };
}

/** `wsl.exe -l -q` prints UTF-16LE (sometimes with a BOM and NULs). Docker's internal distros are not for people. */
export function parseWslList(output: Buffer | string): string[] {
  const textOutput = typeof output === "string" ? output : output.includes(0) ? output.toString("utf16le") : output.toString("utf8");
  return textOutput
    .replace(/^﻿/, "")
    .replace(/\0/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && DISTRO.test(line) && !/^docker-desktop/i.test(line));
}

/**
 * `ssh` options shared by every call: no password prompts (the app has no terminal), keep-alives, port, key.
 * A host seen for the first time is trusted and remembered (as answering "yes" would); a changed key still fails.
 */
export function sshArgs(connection: Extract<Connection, { kind: "ssh" }>): string[] {
  return [
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "ConnectTimeout=15",
    "-o", "ServerAliveInterval=30",
    ...(connection.port ? ["-p", String(connection.port)] : []),
    ...(connection.identityFile ? ["-i", connection.identityFile] : []),
    connection.target,
  ];
}

export const serverPackageName = (version: string, arch: "x64" | "arm64") => `nextflow-studio-server-${version}-linux-${arch}`;

/** `uname -m` → package architecture. */
export function serverArch(uname: string): "x64" | "arm64" | undefined {
  const machine = uname.trim();
  if (machine === "x86_64" || machine === "amd64") return "x64";
  if (machine === "aarch64" || machine === "arm64") return "arm64";
  return undefined;
}

const SERVER_HOME = '"$HOME/.local/share/nextflow-studio/server"';
const SERVE = '"$HOME/.local/share/nextflow-studio/server/current/bin/nextflow-studio"';

/** Prints `version=<installed or empty>` and `arch=<uname -m>`. */
export const PROBE_SCRIPT = `v=$(cat ${SERVER_HOME}/current/VERSION 2>/dev/null || true)
b=$(cat ${SERVER_HOME}/current/BUILD 2>/dev/null || true)
printf 'version=%s\\nbuild=%s\\narch=%s\\n' "$v" "$b" "$(uname -m)"
`;

export function parseProbe(output: string): { version?: string; build?: string; arch?: string } {
  const values = Object.fromEntries(output.split(/\r?\n/).map((line) => line.split("=")).filter((parts) => parts.length === 2).map(([key, value]) => [key!.trim(), value!.trim()]));
  return { version: values.version || undefined, build: values.build || undefined, arch: values.arch || undefined };
}

/**
 * Whether a server must be replaced: another version, or the same version from another build. Used for the installed
 * package and for a server that is already running (started before the update).
 */
export function needsInstall(installed: { version?: string; build?: string }, wanted: { version: string; build?: string }): boolean {
  if (installed.version !== wanted.version) return true;
  return Boolean(wanted.build && installed.build !== wanted.build);
}

/** Stops the server recorded in server.json (after an upgrade, so the next start runs the new files). */
export const STOP_SCRIPT = `f="$HOME/.local/share/nextflow-studio/server.json"
p=$(sed -n 's/.*"pid": *\\([0-9][0-9]*\\).*/\\1/p' "$f" 2>/dev/null)
if [ -n "$p" ] && kill -0 "$p" 2>/dev/null; then
  kill -TERM "$p"
  i=0
  while kill -0 "$p" 2>/dev/null && [ $i -lt 20 ]; do sleep 1; i=$((i + 1)); done
fi
`;

/**
 * What "清除数据" removes from a data directory, and what the desktop app removes before starting a local server
 * on data from another schema version: the database, the example project, run records, launch and work
 * directories. Settings (settings.json, secrets.json), the toolchain, logs, installed servers and projects in
 * their own folders stay.
 */
export const DATA_ENTRIES = ["studio.sqlite", "studio.sqlite-wal", "studio.sqlite-shm", "workspaces", "executions", "pipelines", "work"] as const;

/** Removes DATA_ENTRIES from the server's data directory (run after STOP_SCRIPT). */
export const CLEAR_DATA_SCRIPT = `d="$HOME/.local/share/nextflow-studio"
[ -d "$d" ] || exit 0
cd "$d" && rm -rf -- ${DATA_ENTRIES.join(" ")}
`;

/** Unpacks a package archive read from stdin (ssh) or from `$1` (wsl) and points `current` at it. */
export function installCommand(packageName: string, from: "stdin" | "arg"): string {
  if (!/^nextflow-studio-server-[A-Za-z0-9._-]+$/.test(packageName)) throw new ConnectionError("服务端包名无效");
  // A Windows path (the app's resources) is converted; a path already inside the distro is used as it is.
  const source = from === "stdin" ? "-" : '"$f"';
  const resolve = from === "stdin" ? "" : 'case "$1" in /*) f="$1" ;; *) f=$(wslpath -u "$1") ;; esac; ';
  return `set -e; ${resolve}d=${SERVER_HOME}; mkdir -p "$d"; tar -xzf ${source} -C "$d"; ln -sfn "${packageName}" "$d/current"`;
}

/** Runs `serve` in a login shell (for PATH, Java, conda) and waits in the foreground: the WSL launcher keeps it. */
export const WSL_SERVE_COMMAND = `exec ${SERVE} serve`;

/**
 * Starts `serve` detached on a remote machine so it outlives the ssh session and the desktop app, then prints its
 * ready line. A server already running for that data directory answers with `"reused":true` instead.
 */
export const SSH_START_SCRIPT = `d="$HOME/.local/share/nextflow-studio"
mkdir -p "$d"
out="$d/serve.out"
rm -f "$out"
if command -v setsid >/dev/null 2>&1; then detach=setsid; else detach=; fi
nohup $detach sh -lc 'exec ${SERVE} serve' >"$out" 2>"$d/serve.err" </dev/null &
pid=$!
i=0
while [ $i -lt 180 ]; do
  line=$(grep -m1 '^{"event":"ready"' "$out" 2>/dev/null || true)
  if [ -n "$line" ]; then printf '%s\\n' "$line"; exit 0; fi
  if ! kill -0 "$pid" 2>/dev/null; then tail -n 20 "$d/serve.err" >&2; exit 1; fi
  sleep 1
  i=$((i + 1))
done
echo "服务端 180 秒内没有就绪" >&2
exit 1
`;
