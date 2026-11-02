#!/usr/bin/env node
// The Electron shell alone: main and preload to dist/, plus the connect page. Needs only desktop/'s own
// dependencies, so it also works on Windows, where the app connects to WSL or a remote server and does not need
// the Next.js server or the runner built here.
import { cpSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function bundleShell() {
  await build({
    entryPoints: { main: join(desktop, "src", "main.ts"), preload: join(desktop, "src", "preload.ts") },
    outdir: join(desktop, "dist"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron", "electron-updater"],
    logLevel: "info",
  });
  cpSync(join(desktop, "src", "connect"), join(desktop, "dist", "connect"), { recursive: true });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await bundleShell();
