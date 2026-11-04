// Shared by the Node build scripts and electron-builder. The JSON registry is also imported by the UI.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";

export const root = fileURLToPath(new URL("../../", import.meta.url));
const themes = JSON.parse(readFileSync(join(root, "src/lib/product-theme/themes.json"), "utf8"));

export function loadProductTheme(envDir = root) {
  const { combinedEnv } = nextEnv.loadEnvConfig(envDir, false);
  const id = combinedEnv.NEXT_PUBLIC_PRODUCT_THEME || themes[0].id;
  const theme = themes.find((item) => item.id === id);
  // Fail a misspelled build selection instead of shipping an installer with the wrong brand.
  if (!theme) throw new Error(`Unknown NEXT_PUBLIC_PRODUCT_THEME: ${id}`);
  for (const key of ["icon", "trayIcon"]) {
    if (!/^\/brands\/[\w/-]+\.png$/.test(theme[key]) || !existsSync(join(root, "public", theme[key]))) {
      throw new Error(`Missing or invalid ${key} for product theme ${id}: ${theme[key]}`);
    }
  }
  return theme;
}
