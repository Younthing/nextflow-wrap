#!/usr/bin/env node
// `pnpm start`: rebuild the local server and the shell from this checkout, then open the app (macOS, Linux).
// Windows cannot build the local server (the app runs it in WSL there), so this is `pnpm dev:win` instead.
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");

if (process.platform === "win32") {
  const { devWin } = await import("./dev-win.mjs");
  await devWin();
} else {
  const bundled = spawnSync(process.execPath, [join(desktop, "scripts", "bundle.mjs"), "--skip-server"], { cwd: desktop, stdio: "inherit" });
  if (bundled.status !== 0) process.exit(bundled.status ?? 1);
  await import("./dev.mjs");
}
