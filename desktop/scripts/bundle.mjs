#!/usr/bin/env node
// Builds everything the desktop app ships in resources/:
//   app-server/   Next.js standalone server (+ .next/static and public/), also packed as app-server.tar.gz
//   runner/       scripts/runner.ts bundled to one ESM file
//   plugins/      nf-weblog unpacked by `nextflow plugin install`, so live progress works offline
// and compiles the Electron main and preload scripts to dist/.
//
//   node scripts/bundle.mjs              full build
//   node scripts/bundle.mjs --skip-next  reuse the last Next.js build (main/preload/runner only)
import { rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

import { buildStandalone, bundleScript, prefetchWeblog, run } from "../../scripts/build-parts.mjs";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const resources = join(desktop, "resources");
const skipNext = process.argv.includes("--skip-next");

if (!skipNext) {
  buildStandalone(join(resources, "app-server"));
  // electron-builder leaves node_modules out of extra resources, so the server ships as one archive that the
  // app unpacks on first start of each version (see appServerDirectory in src/main.ts).
  rmSync(join(resources, "app-server.tar.gz"), { force: true });
  run("tar", ["-czf", join(resources, "app-server.tar.gz"), "-C", resources, "app-server"]);
}

// The runner runs in an Electron utility process (Node with node:sqlite).
await bundleScript("runner.ts", join(resources, "runner", "runner.mjs"));

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

prefetchWeblog(join(resources, "plugins"));
writeFileSync(join(resources, "BUILD"), `${new Date().toISOString()}\n`);
