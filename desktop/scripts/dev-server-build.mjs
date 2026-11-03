#!/usr/bin/env node
// Builds the Linux server package from a Windows checkout, inside WSL. Started by wsl-bootstrap.sh with the Node.js
// it installed (never the person's own), so it may use only Node's standard library.
//
//   node dev-server-build.mjs --src <checkout> --tools <toolchain/build> --node-dir <node> --arch x64|arm64 [--fresh]
//
// Steps, each announced as "== [n/6] …", with a heartbeat while a long step is quiet and a time limit:
//   1. pnpm at package.json's version, installed with this Node's npm under --tools
//   2. copy the checkout to ~/.cache/nextflow-studio/dev-src (only changed files; node_modules and .next stay there,
//      so installs and builds are incremental)
//   3. pnpm install
//   4. scripts/build-server.mjs (the package ships this same Node: NEXTFLOW_STUDIO_BUILD_NODE)
//   5. stop the server running in WSL; clear its data (DATA_ENTRIES) when it was written by another schema version
//      (no migrations) or with --fresh
//   6. copy the package to <checkout>/desktop/resources/server, where the desktop shell installs it from
import { spawn } from "node:child_process";
import { chmodSync, copyFileSync, createWriteStream, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * What clearing the WSL server's data removes: the same entries as "清除数据" in the app (DATA_ENTRIES in
 * src/features/desktop/connections.ts; a test keeps the two equal). Settings, the toolchain, logs and installed
 * servers stay.
 */
export const DATA_ENTRIES = ["studio.sqlite", "studio.sqlite-wal", "studio.sqlite-shm", "workspaces", "executions", "pipelines", "work"];

/** Top-level paths of the checkout that are not copied (and are kept in the copy: node_modules, .next). */
export const EXCLUDED = new Set([
  ".git", "node_modules", ".next", "dist-server", ".codegraph", "storybook-static", "test-results", "playwright-report",
  "desktop/node_modules", "desktop/dist", "desktop/resources", "desktop/release",
]);
const excluded = (rel) => EXCLUDED.has(rel) || /^nxf-tmp\./.test(rel);

/**
 * Makes `dst` a copy of `src` without rsync: files whose size or modification time differ are copied (keeping the
 * time, so the next run skips them), files gone from `src` are removed, excluded paths are left alone on both
 * sides. Returns how many files were copied and removed.
 */
export function syncTree(src, dst, rel = "", counts = { copied: 0, removed: 0 }) {
  mkdirSync(dst, { recursive: true });
  const entries = readdirSync(src, { withFileTypes: true }).filter((entry) => !excluded(rel ? `${rel}/${entry.name}` : entry.name));
  const names = new Set(entries.map((entry) => entry.name));
  for (const name of readdirSync(dst)) {
    const path = rel ? `${rel}/${name}` : name;
    if (!names.has(name) && !excluded(path)) { rmSync(join(dst, name), { recursive: true, force: true }); counts.removed++; }
  }
  for (const entry of entries) {
    const from = join(src, entry.name);
    const to = join(dst, entry.name);
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    const existing = existsSync(to) || isLink(to) ? lstatSync(to) : undefined;
    if (entry.isDirectory()) {
      if (existing && !existing.isDirectory()) rmSync(to, { recursive: true, force: true });
      syncTree(from, to, path, counts);
    } else if (entry.isSymbolicLink()) {
      const target = readlinkSync(from);
      if (existing && !(existing.isSymbolicLink() && readlinkSync(to) === target)) rmSync(to, { recursive: true, force: true });
      if (!existing || !existing.isSymbolicLink() || readlinkSync(to) !== target) { symlinkSync(target, to); counts.copied++; }
    } else if (entry.isFile()) {
      const source = statSync(from);
      if (existing && existing.isDirectory()) rmSync(to, { recursive: true, force: true });
      const same = existing?.isFile() && existing.size === source.size && Math.abs(existing.mtimeMs - source.mtimeMs) < 1;
      if (!same) {
        copyFileSync(from, to);
        utimesSync(to, source.atime, source.mtime);
        counts.copied++;
      }
    }
  }
  return counts;
}

function isLink(path) {
  try { return lstatSync(path).isSymbolicLink(); } catch { return false; }
}

function parseArgs(argv) {
  const options = { fresh: false };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--fresh") options.fresh = true;
    else if (flag.startsWith("--")) options[flag.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = argv[++index];
  }
  for (const key of ["src", "tools", "nodeDir", "arch"]) if (!options[key]) throw new Error(`缺少 --${key}`);
  return options;
}

class StepError extends Error {}

/**
 * Runs a command, passing its output through line by line (the app shows the latest line as status) and into the
 * log. Prints a heartbeat when it has been quiet for a while, and stops it when it takes longer than `limitMs`.
 */
function run(title, command, args, { cwd, env, limitMs, log }) {
  return new Promise((done, fail) => {
    const started = Date.now();
    let lastOutput = Date.now();
    let tail = "";
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    const forward = (stream, chunk) => {
      lastOutput = Date.now();
      log.write(chunk);
      tail = (tail + chunk.toString()).slice(-3000);
      stream.write(chunk);
    };
    child.stdout.on("data", (chunk) => forward(process.stdout, chunk));
    child.stderr.on("data", (chunk) => forward(process.stderr, chunk));
    const heartbeat = setInterval(() => {
      if (Date.now() - lastOutput < 30_000) return;
      console.log(`   …仍在${title}（已 ${Math.round((Date.now() - started) / 1000)} 秒）`);
      lastOutput = Date.now();
    }, 5_000);
    const limit = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
      fail(new StepError(`${title}超过 ${Math.round(limitMs / 60_000)} 分钟没有完成，已停止。日志：${log.path}`));
    }, limitMs);
    child.on("error", (error) => { clearInterval(heartbeat); clearTimeout(limit); fail(new StepError(`${title}：无法启动 ${command}（${error.message}）`)); });
    child.on("close", (code, signal) => {
      clearInterval(heartbeat);
      clearTimeout(limit);
      if (code === 0) done();
      else fail(new StepError(`${title}失败（${code ?? signal}）：${tail.trim().split("\n").slice(-3).join(" ")}\n日志：${log.path}`));
    });
  });
}

/**
 * pnpm at package.json's version, installed with this Node's npm into <tools>/pnpm-<version> (pnpm 11+ ships a
 * native binary that the corepack bundled with Node cannot start), and put on PATH as `pnpm`, so scripts that call
 * `pnpm` (build-parts.mjs) find it. Returns the environment for every later step.
 */
async function preparePnpm(tools, nodeDir, packageManager, log) {
  const version = packageManager.slice("pnpm@".length);
  const prefix = join(tools, `pnpm-${version}`);
  const installed = join(prefix, "node_modules", ".bin", "pnpm");
  const bin = join(tools, "bin");
  const env = {
    ...process.env,
    PATH: `${bin}:${join(nodeDir, "bin")}:${process.env.PATH ?? "/usr/bin:/bin"}`,
    npm_config_update_notifier: "false",
    npm_config_fund: "false",
    npm_config_audit: "false",
    CI: "true",
  };
  const current = await output(installed, ["--version"], env);
  if (current !== version) {
    console.log(`   安装 pnpm ${version} 到 ${prefix}（只装一次）`);
    rmSync(prefix, { recursive: true, force: true });
    mkdirSync(prefix, { recursive: true });
    writeFileSync(join(prefix, "package.json"), "{\"private\":true}\n");
    await run("安装 pnpm", join(nodeDir, "bin", "npm"), ["install", "--prefix", prefix, "--no-save", `pnpm@${version}`], { cwd: prefix, env, limitMs: 10 * 60_000, log });
    const now = await output(installed, ["--version"], env);
    if (now !== version) throw new StepError(`pnpm ${version} 安装后无法运行（得到 ${now || "无输出"}）`);
  }
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "pnpm"), `#!/bin/sh\nexec "${installed}" "$@"\n`);
  chmodSync(join(bin, "pnpm"), 0o755);
  console.log(`   pnpm ${version}`);
  return env;
}

/** First line of a command's stdout, or "" when it cannot run. */
function output(command, args, env) {
  return new Promise((done) => {
    if (!existsSync(command)) { done(""); return; }
    const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "ignore"] });
    let text = "";
    child.stdout.on("data", (chunk) => { text += chunk; });
    child.on("error", () => done(""));
    child.on("close", () => done(text.trim().split("\n")[0] ?? ""));
  });
}

/** Stops the WSL server recorded in server.json and waits for it, as STOP_SCRIPT does. */
async function stopServer(data) {
  let pid;
  try { pid = JSON.parse(readFileSync(join(data, "server.json"), "utf8")).pid; } catch { return false; }
  if (!Number.isInteger(pid)) return false;
  try { process.kill(pid, "SIGTERM"); } catch { return false; }
  for (let waited = 0; waited < 20_000; waited += 500) {
    try { process.kill(pid, 0); } catch { return true; }
    await new Promise((wait) => setTimeout(wait, 500));
  }
  try { process.kill(pid, "SIGKILL"); } catch { /* Gone. */ }
  return true;
}

/** user_version of the WSL server's database, or undefined without one. */
async function databaseVersion(file) {
  if (!existsSync(file)) return undefined;
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(file, { readOnly: true });
    try { return Number(db.prepare("PRAGMA user_version").get()?.user_version ?? 0); } finally { db.close(); }
  } catch {
    return "unreadable";
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const src = resolve(options.src);
  const work = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "nextflow-studio", "dev-src");
  const data = join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "nextflow-studio");
  mkdirSync(join(data, "logs"), { recursive: true });
  const logPath = join(data, "logs", "dev-build.log");
  const log = Object.assign(createWriteStream(logPath, { flags: "w" }), { path: logPath });
  const total = 6;
  let index = 0;
  const step = (title) => {
    index++;
    const line = `== [${index}/${total}] ${title}`;
    console.log(line);
    log.write(`${line}\n`);
  };

  // Node's own warnings (node:sqlite is still experimental) are not news here.
  process.removeAllListeners("warning");

  step("准备 pnpm");
  const packageJson = JSON.parse(readFileSync(join(src, "package.json"), "utf8"));
  const packageManager = String(packageJson.packageManager ?? "").replace(/\+.*$/, "");
  if (!packageManager.startsWith("pnpm@")) throw new StepError("package.json 没有指定 pnpm 版本（packageManager）");
  const env = { ...(await preparePnpm(options.tools, options.nodeDir, packageManager, log)), NEXTFLOW_STUDIO_BUILD_NODE: options.nodeDir };

  step(`同步源码到 ${work}`);
  const started = Date.now();
  const counts = syncTree(src, work);
  console.log(`   复制 ${counts.copied} 个文件，删除 ${counts.removed} 个（${Math.round((Date.now() - started) / 1000)} 秒）`);

  step("安装依赖（第一次需要几分钟）");
  await run("安装依赖", "pnpm", ["install", "--frozen-lockfile"], { cwd: work, env, limitMs: 30 * 60_000, log });

  step(`构建服务端（linux-${options.arch}）`);
  rmSync(join(work, "dist-server"), { recursive: true, force: true });
  await run("构建服务端", join(options.nodeDir, "bin", "node"), [join(work, "scripts", "build-server.mjs"), "--arch", options.arch], { cwd: work, env, limitMs: 40 * 60_000, log });
  const pkg = readdirSync(join(work, "dist-server")).find((name) => name.endsWith(`-linux-${options.arch}.tar.gz`));
  if (!pkg) throw new StepError("没有生成服务端包");
  const name = pkg.slice(0, -".tar.gz".length);

  step("停止 WSL 里正在运行的服务端");
  console.log(await stopServer(data) ? "   已停止" : "   没有在运行");
  const want = Number(/export const SCHEMA_VERSION = (\d+);/.exec(readFileSync(join(work, "src", "lib", "server", "schema.ts"), "utf8"))?.[1]);
  const have = await databaseVersion(join(data, "studio.sqlite"));
  if (options.fresh || (have !== undefined && have !== want)) {
    console.log(`   清除数据 ${data}（数据格式 ${have ?? "无"} → ${want}；设置、工具链和日志保留）`);
    for (const entry of DATA_ENTRIES) rmSync(join(data, entry), { recursive: true, force: true });
  }

  step("把服务端包放到 desktop/resources/server");
  const out = join(src, "desktop", "resources", "server");
  mkdirSync(out, { recursive: true });
  for (const entry of readdirSync(out)) if (entry.startsWith("nextflow-studio-server-")) rmSync(join(out, entry), { force: true });
  copyFileSync(join(work, "dist-server", pkg), join(out, pkg));
  copyFileSync(join(work, "dist-server", `${name}.build`), join(out, `${name}.build`));
  const build = readFileSync(join(out, `${name}.build`), "utf8").trim();
  console.log(`== 完成：${join(out, pkg)}（构建 ${build}）`);
  log.end();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`dev:win: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(3);
  });
}

