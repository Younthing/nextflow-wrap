#!/usr/bin/env node
// `pnpm dev` (and `pnpm start`): the development desktop app, always running the server built from this checkout,
// the same way on every platform. A shell or server left over from an earlier build is what makes one platform show
// another version than the others, so both are rebuilt on every start:
//
//   Windows        the server runs in WSL and is built there (dev-win.mjs → wsl-bootstrap.sh)
//   macOS, Linux   bundle.mjs rebuilds the local server (resources/app-server, runner) and the shell
//
//   pnpm dev                  rebuild, then start
//   pnpm dev --skip-server    only the shell; reuse the last server build (it may be older than the code)
//   pnpm dev --fresh          Windows: also clear the WSL server's data
//   pnpm dev --no-sandbox     forward to Electron (WSL/root; Chromium refuses root without it)
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { bundleShell } from "./bundle-shell.mjs";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

if (process.platform === "win32") {
  const { devWin } = await import("./dev-win.mjs");
  await devWin();
} else {
  if (args.includes("--skip-server")) {
    await bundleShell();
  } else {
    // --skip-server here only skips the Linux packages for WSL and SSH, which a local run does not use.
    const bundled = spawnSync(process.execPath, [join(desktop, "scripts", "bundle.mjs"), "--skip-server"], { cwd: desktop, stdio: "inherit" });
    if (bundled.status !== 0) process.exit(bundled.status ?? 1);
  }
  const electronBinary = createRequire(import.meta.url)("electron");
  // Chromium flags such as --no-sandbox (needed when the WSL user is root).
  const electronArgs = [".", "--dev", ...args.filter((arg) => arg === "--no-sandbox")];
  const electron = spawn(electronBinary, electronArgs, { cwd: desktop, stdio: "inherit" });
  electron.on("exit", (code) => process.exit(code ?? 0));
}
