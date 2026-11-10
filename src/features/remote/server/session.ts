import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packScript, sq, sshArgs } from "../ssh";
import type { RemoteHost } from "../types";

export class RemoteError extends Error {
  constructor(message: string, readonly exitCode: number | null, readonly stderr: string) { super(message); }
}

/**
 * The ssh client. `NEXTFLOW_STUDIO_SSH` points tests (and unusual installs) at another binary; the tests use a
 * shim that runs the command locally, so the same code path runs against a real Nextflow without a server.
 */
export const sshBinary = (env: NodeJS.ProcessEnv = process.env) => env.NEXTFLOW_STUDIO_SSH?.trim() || "ssh";

/** Short, private directory for ssh control sockets; socket paths must stay under ~100 bytes. */
function controlDirectory() {
  const dir = join(tmpdir(), `nfs-ssh-${process.getuid?.() ?? "u"}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

interface Exec { stdin?: string | NodeJS.ReadableStream; timeoutMs?: number; signal?: AbortSignal }

/** One host's ssh connection. Each call is its own `ssh` process sharing a control socket. */
export class SshSession {
  readonly args: string[];
  constructor(readonly host: RemoteHost, readonly env: NodeJS.ProcessEnv = process.env, controlDir: string | undefined = controlDirectory()) {
    this.args = sshArgs(host, env.NEXTFLOW_STUDIO_SSH ? undefined : controlDir);
  }

  /** Runs `command` on the host; with `stdout` the output streams there instead of being returned. */
  exec(command: string, options: Exec & { stdout?: NodeJS.WritableStream } = {}): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(/* turbopackIgnore: true */ sshBinary(this.env), [...this.args, command], { env: this.env, stdio: ["pipe", "pipe", "pipe"] });
      let out = "";
      let err = "";
      const timer = setTimeout(() => child.kill("SIGTERM"), options.timeoutMs ?? 120_000);
      const abort = () => child.kill("SIGTERM");
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.stdout) child.stdout.pipe(options.stdout);
      else child.stdout.on("data", (chunk: Buffer) => { out += chunk.toString("utf8"); if (out.length > 64 * 1024 ** 2) child.kill("SIGTERM"); });
      child.stderr.on("data", (chunk: Buffer) => { err = (err + chunk.toString("utf8")).slice(-16_000); });
      child.stdin.on("error", () => {});
      if (typeof options.stdin === "string") child.stdin.end(options.stdin);
      else if (options.stdin) options.stdin.pipe(child.stdin);
      else child.stdin.end();
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("close", (code) => {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
        if (code === 0) resolve(out);
        else reject(new RemoteError(sshFailure(this.host, code, err), code, err));
      });
    });
  }

  /** A shell script on the host, sent on stdin. Login scripts load the cluster's modules and PATH. */
  script(text: string, options: Exec & { login?: boolean } = {}) {
    return this.exec(options.login ? "bash -l -s" : "sh -s", { ...options, stdin: text });
  }

  /**
   * Copies a local directory into `remoteDir`, keeping modification times so Nextflow's task cache (which hashes
   * bin/ scripts by path and mtime) still matches on the next run. `remoteDir` must be a checked absolute path.
   */
  async upload(localDir: string, remoteDir: string, exclude: string[] = []) {
    const tar = spawn("tar", ["-C", localDir, ...exclude.flatMap((pattern) => ["--exclude", pattern]), "-cf", "-", "."], { stdio: ["ignore", "pipe", "pipe"] });
    let tarError = "";
    tar.stderr.on("data", (chunk: Buffer) => { tarError += chunk.toString("utf8"); });
    const tarDone = new Promise<number | null>((resolve) => tar.once("close", resolve));
    await this.exec(`mkdir -p ${remoteDir} && tar -xf - -C ${remoteDir}`, { stdin: tar.stdout, timeoutMs: 30 * 60_000 });
    if ((await tarDone) !== 0) throw new Error(`打包 ${localDir} 失败：${tarError}`);
  }

  /** Copies `files` (relative to `localRoot`) into the same relative places under `remoteDir`, keeping mtimes. */
  async uploadFiles(localRoot: string, remoteDir: string, files: string[]) {
    if (!files.length) return;
    const tar = spawn("tar", ["-C", localRoot, "-cf", "-", "--", ...files], { stdio: ["ignore", "pipe", "pipe"] });
    let tarError = "";
    tar.stderr.on("data", (chunk: Buffer) => { tarError += chunk.toString("utf8"); });
    const tarDone = new Promise<number | null>((resolve) => tar.once("close", resolve));
    await this.exec(`mkdir -p ${sq(remoteDir)} && tar -xf - -C ${sq(remoteDir)}`, { stdin: tar.stdout, timeoutMs: 6 * 60 * 60_000 });
    if ((await tarDone) !== 0) throw new Error(`打包 ${localRoot} 里的数据失败：${tarError}`);
  }

  /** Copies the existing `entries` of a remote directory into `localDir`. Missing entries are skipped. */
  async download(remoteDir: string, entries: string[], localDir: string, timeoutMs = 30 * 60_000) {
    await mkdir(localDir, { recursive: true });
    const archive = join(localDir, `.remote-${process.pid}-${Date.now()}.tar`);
    try {
      await this.exec("sh -s", { stdin: packScript(remoteDir, entries), stdout: createWriteStream(archive), timeoutMs });
      if ((await stat(archive)).size === 0) return;
      await new Promise<void>((resolve, reject) => {
        const tar = spawn("tar", ["-xf", archive, "-C", localDir], { stdio: ["ignore", "ignore", "pipe"] });
        let error = "";
        tar.stderr.on("data", (chunk: Buffer) => { error += chunk.toString("utf8"); });
        tar.once("error", reject);
        tar.once("close", (code) => (code === 0 ? resolve() : reject(new Error(`解包失败：${error}`))));
      });
    } finally {
      await rm(archive, { force: true });
    }
  }
}

/** A message a person can act on, from ssh's exit status and stderr. */
export function sshFailure(host: RemoteHost, code: number | null, stderr: string): string {
  const text = stderr.trim();
  const where = host.user ? `${host.user}@${host.host}` : host.host;
  if (/Permission denied|publickey|Authentication failed/i.test(text)) return `${where}：SSH 认证失败。桌面版不能输入密码，请配置密钥（ssh-agent 或「私钥文件」）。\n${text}`;
  if (/Could not resolve hostname|Name or service not known|nodename nor servname/i.test(text)) return `${where}：找不到这个主机名。\n${text}`;
  if (/timed out|Connection refused|No route to host|Network is unreachable/i.test(text)) return `${where}：连不上（网络、VPN 或端口）。\n${text}`;
  if (/Host key verification failed/i.test(text)) return `${where}：主机密钥未确认。请先在终端里 ssh 一次并确认指纹。\n${text}`;
  return `${where}：远程命令退出码 ${code ?? "信号"}\n${text}`;
}
