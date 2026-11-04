// Regenerate committed packaging assets after editing a brand's vector mark. Not required during packaging.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const requireNext = createRequire(createRequire(import.meta.url).resolve("next/package.json"));
const sharp = requireNext("sharp");
const themes = JSON.parse(readFileSync(join(root, "src/lib/product-theme/themes.json"), "utf8"));

for (const theme of themes) {
  const mark = readFileSync(join(root, "public", "brands", theme.id, "mark.svg"), "utf8")
    .replace(/<svg[^>]*>/, "").replace("</svg>", "");
  // The primary colour matches the application's light theme; artwork stays vector-native.
  const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 32 32">
    <rect width="32" height="32" rx="8" fill="rgb(56,112,229)"/>
    <g color="white" fill="none">${mark}</g></svg>`;
  const tray = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 32 32"><g color="black" fill="none">${mark}</g></svg>`;
  await sharp(Buffer.from(icon)).png().toFile(join(root, "public", theme.icon));
  await sharp(Buffer.from(tray)).png().toFile(join(root, "public", theme.trayIcon));
}
