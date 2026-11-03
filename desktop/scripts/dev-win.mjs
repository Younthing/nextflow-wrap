#!/usr/bin/env node
// `pnpm dev:win`: the development desktop app on Windows, always with the server built from this checkout.
//
// The window shell is bundled here. The server (UI, /api, runner) runs in WSL, so it is built there by
// wsl-bootstrap.sh, which installs what the build needs (Node.js, pnpm) into ~/.local/share/nextflow-studio/toolchain/
// build and then runs dev-server-build.mjs: sync this checkout into WSL, install, build the Linux package, stop the
// running server (clearing data of another schema version) and put the package in desktop/resources/server. Each
// package has its own build id, so connecting to WSL (or over SSH) installs it instead of reusing an older one.
// Nothing in WSL needs to be set up beforehand, and the person's shell rc files are never read.
//
//   pnpm dev:win                 build the server, then start
//   pnpm dev:win --fresh         also clear the WSL server's data (settings, toolchain, projects in their own folders stay)
//   pnpm dev:win --skip-server   only the shell; the last package in resources/server is used
//   NEXTFLOW_STUDIO_WSL_DISTRO=Ubuntu-24.04 pnpm dev:win    build in that distro (default: the WSL default)
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { bundleShell } from "./bundle-shell.mjs";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(desktop, "..");
const args = process.argv.slice(2);

/** The WSL side, piped to /bin/sh (no login shell: profiles and rc files stay out of it). */
export const wslBuildCommand = (distro) => ["wsl.exe", [...(distro ? ["-d", distro] : []), "--exec", "/bin/sh", "-s", "--"]];
export const wslBuildScript = () => readFileSync(join(desktop, "scripts", "wsl-bootstrap.sh"), "utf8").replace(/\r\n/g, "\n");

export async function devWin() {
  await bundleShell();

  if (!args.includes("--skip-server")) {
    if (process.platform !== "win32") {
      console.error("dev:win 在 WSL 里构建服务端，只能在 Windows 上运行。macOS / Linux 用 pnpm start。");
      process.exit(1);
    }
    const [command, commandArgs] = wslBuildCommand(process.env.NEXTFLOW_STUDIO_WSL_DISTRO);
    console.log("== 在 WSL 里构建服务端（输出也写在 WSL 的 ~/.local/share/nextflow-studio/logs/dev-build.log）");
    const result = spawnSync(command, [...commandArgs, root, ...(args.includes("--fresh") ? ["--fresh"] : [])], {
      input: wslBuildScript(),
      stdio: ["pipe", "inherit", "inherit"],
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }

  // The electron package exports the path of its binary.
  const electronBinary = createRequire(import.meta.url)("electron");
  const electron = spawn(electronBinary, [".", "--dev"], { cwd: desktop, stdio: "inherit" });
  electron.on("exit", (code) => process.exit(code ?? 0));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await devWin();
