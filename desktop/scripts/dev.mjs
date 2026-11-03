#!/usr/bin/env node
// `pnpm dev`: the development desktop app, always from this checkout.
//
// The Electron main and preload scripts are bundled first, so a pull is never followed by a run of the previous
// shell. On Windows the server runs in WSL and must be built there too: this is `pnpm dev:win` (see dev-win.mjs).
// Elsewhere Electron starts with the server last bundled into resources/ (`pnpm start` rebuilds it as well).
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { bundleShell } from "./bundle-shell.mjs";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");

if (process.platform === "win32") {
  await import("./dev-win.mjs");
} else {
  await bundleShell();
  const electronBinary = createRequire(import.meta.url)("electron");
  const electron = spawn(electronBinary, [".", "--dev", ...process.argv.slice(2)], { cwd: desktop, stdio: "inherit" });
  electron.on("exit", (code) => process.exit(code ?? 0));
}
