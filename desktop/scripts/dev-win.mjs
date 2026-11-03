#!/usr/bin/env node
// `pnpm dev:win`: the development desktop app on Windows, always with the server built from this checkout.
//
// The window shell is bundled here. The server (UI, /api, runner) runs in WSL, so it is built there:
//   1. this checkout is copied into WSL (~/.cache/nextflow-studio/dev-src; node_modules and .next stay there
//      between runs, so later builds are incremental) and `scripts/build-server.mjs` builds the Linux package;
//   2. a server still running in WSL is stopped, and a data directory written by another schema version is
//      cleared (no migrations; the toolchain and installed servers are kept);
//   3. the package is copied to desktop/resources/server, where the shell finds it. Each build has its own id, so
//      connecting to WSL (or over SSH) installs it instead of reusing what was installed before;
//   4. Electron starts with --dev.
//
//   pnpm dev:win                 build the server, then start
//   pnpm dev:win --fresh         also clear the WSL data directory (projects in their own folders are untouched)
//   pnpm dev:win --skip-server   only the shell; the last package in resources/server is used
//   NEXTFLOW_STUDIO_WSL_DISTRO=Ubuntu-24.04 pnpm dev:win    build in that distro (default: the WSL default)
//
// WSL needs nothing set up: a Node.js 22.5+ is found wherever it was installed (nvm, fnm, volta, apt…) or downloaded
// once into ~/.cache/nextflow-studio; without rsync the source is copied with tar.
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { bundleShell } from "./bundle-shell.mjs";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(desktop, "..");
const args = process.argv.slice(2);

// Read here and piped to sh, so line endings from a Windows checkout do not matter.
// wsl-node.sh (finding or fetching Node.js) goes first: the build script calls its functions.
const BUILD = ["wsl-node.sh", "dev-win-build.sh"].map((name) => readFileSync(join(desktop, "scripts", name), "utf8")).join("\n").replace(/\r\n/g, "\n");

function wsl(script, scriptArgs) {
  const distro = process.env.NEXTFLOW_STUDIO_WSL_DISTRO;
  const result = spawnSync("wsl.exe", [...(distro ? ["-d", distro] : []), "--exec", "sh", "-l", "-s", "--", ...scriptArgs], {
    input: script,
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

await bundleShell();

if (!args.includes("--skip-server")) {
  if (process.platform !== "win32") {
    console.error("dev:win 在 WSL 里构建服务端，只能在 Windows 上运行。macOS / Linux 用 pnpm start。");
    process.exit(1);
  }
  const status = wsl(BUILD, [root, args.includes("--fresh") ? "1" : "0"]);
  if (status !== 0) process.exit(status);
}

// The electron package exports the path of its binary.
const electronBinary = createRequire(import.meta.url)("electron");
const electron = spawn(electronBinary, [".", "--dev"], { cwd: desktop, stdio: "inherit" });
electron.on("exit", (code) => process.exit(code ?? 0));
