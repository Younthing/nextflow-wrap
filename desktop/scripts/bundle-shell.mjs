#!/usr/bin/env node
// The Electron shell alone: main and preload to dist/, plus the connect page. Needs only desktop/'s own
// dependencies, so it also works on Windows, where the app connects to WSL or a remote server and does not need
// the Next.js server or the runner built here.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { loadProductTheme, root } from "./product-theme.mjs";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function bundleShell({ outdir = join(desktop, "dist"), envDir = resolve(desktop, "..") } = {}) {
  // The desktop dev commands build a production Next.js server too. Match its .env* precedence,
  // then inline only the public theme id so installed shells need neither .env files nor shell exports.
  const theme = loadProductTheme(envDir);
  await build({
    entryPoints: { main: join(desktop, "src", "main.ts"), preload: join(desktop, "src", "preload.ts") },
    outdir,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron", "electron-updater"],
    define: { "process.env.NEXT_PUBLIC_PRODUCT_THEME": JSON.stringify(theme.id) },
    logLevel: "info",
  });
  cpSync(join(desktop, "src", "connect"), join(outdir, "connect"), { recursive: true });
  const escapeHtml = (text) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
  const page = join(outdir, "connect", "index.html");
  writeFileSync(page, readFileSync(page, "utf8")
    .replaceAll("__PRODUCT_DISPLAY_NAME__", escapeHtml(theme.displayName))
    .replaceAll("__PRODUCT_SHORT_NAME__", escapeHtml(theme.shortName)));
  mkdirSync(join(outdir, "brand"), { recursive: true });
  cpSync(join(root, "public", theme.icon), join(outdir, "brand", "icon.png"));
  cpSync(join(root, "public", theme.trayIcon), join(outdir, "brand", "trayTemplate.png"));
  writeFileSync(join(outdir, "brand", "theme.json"), `${JSON.stringify({ id: theme.id })}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await bundleShell();
