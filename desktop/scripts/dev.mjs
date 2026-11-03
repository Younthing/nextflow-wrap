#!/usr/bin/env node
// `pnpm dev`: the development desktop app, always rebuilt from scratch from this checkout, so it can never show
// an older build.
//
// On macOS and Linux everything the app hosts is deleted and built again: the Next.js build (.next, including its
// cache), the standalone server in resources/app-server, the runner and the shell in dist/. The app then starts
// with --dev, which serves resources/app-server directly (never a copy unpacked into userData), and clears the
// window's HTTP cache and service workers when it connects.
//
// On Windows the server runs in WSL, so this is `pnpm dev:win` (scripts/dev-win.mjs).
//
//   pnpm dev              clean rebuild, then start
//   pnpm dev --fresh      also clear the local data directory's database, example project and run records
import { spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(desktop, "..");
const args = process.argv.slice(2);

const step = (command, commandArgs, cwd) => {
  const result = spawnSync(command, commandArgs, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};

if (process.platform === "win32") {
  step(process.execPath, [join(desktop, "scripts", "dev-win.mjs"), ...args], desktop);
  process.exit(0);
}

console.log("== 清理上一次的构建");
for (const path of [
  join(root, ".next"),
  join(desktop, "dist"),
  join(desktop, "resources", "app-server"),
  join(desktop, "resources", "app-server.tar.gz"),
  join(desktop, "resources", "app-server.build"),
  join(desktop, "resources", "runner"),
]) rmSync(path, { recursive: true, force: true });

console.log("== 用当前代码重新构建");
// The Linux server package (WSL / SSH backends) is left out: it is only needed when connecting to another machine.
step(process.execPath, [join(desktop, "scripts", "bundle.mjs"), "--skip-server"], desktop);

const electronBinary = createRequire(import.meta.url)("electron");
const electron = spawn(electronBinary, [".", "--dev", ...(args.includes("--fresh") ? ["--fresh"] : [])], { cwd: desktop, stdio: "inherit" });
electron.on("exit", (code) => process.exit(code ?? 0));
