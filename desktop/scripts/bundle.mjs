#!/usr/bin/env node
// Builds everything the desktop app ships in resources/:
//   app-server/   Next.js standalone server (+ .next/static and public/), also packed as app-server.tar.gz
//   runner/       scripts/runner.ts bundled to one ESM file
//   plugins/      nf-weblog unpacked by `nextflow plugin install`, so live progress works offline
// and compiles the Electron main and preload scripts to dist/.
//
//   node scripts/bundle.mjs              full build
//   node scripts/bundle.mjs --skip-next  reuse the last Next.js build (main/preload/runner only)
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(desktop, "..");
const resources = join(desktop, "resources");
const skipNext = process.argv.includes("--skip-next");
const WEBLOG = "nf-weblog@1.2.0";

const run = (bin, args, options = {}) => execFileSync(bin, args, { stdio: "inherit", cwd: root, ...options });

mkdirSync(resources, { recursive: true });

if (!skipNext) {
  run("pnpm", ["build"], { env: { ...process.env, NEXT_OUTPUT: "standalone", NEXT_PUBLIC_API_MOCKING: "disabled" } });
  const server = join(resources, "app-server");
  rmSync(server, { recursive: true, force: true });
  cpSync(join(root, ".next", "standalone"), server, { recursive: true, verbatimSymlinks: true });
  cpSync(join(root, ".next", "static"), join(server, ".next", "static"), { recursive: true });
  cpSync(join(root, "public"), join(server, "public"), { recursive: true });
  // electron-builder leaves node_modules out of extra resources, so the server ships as one archive that the
  // app unpacks on first start of each version (see appServerDirectory in src/main.ts).
  rmSync(join(resources, "app-server.tar.gz"), { force: true });
  run("tar", ["-czf", join(resources, "app-server.tar.gz"), "-C", resources, "app-server"]);
}

// The runner runs in an Electron utility process (Node with node:sqlite); bundle it with the @/ alias resolved.
await build({
  entryPoints: [join(root, "scripts", "runner.ts")],
  outfile: join(resources, "runner", "runner.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  tsconfig: join(root, "tsconfig.json"),
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "info",
});

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

// nf-weblog: offline live progress. Skipped (with a warning) when the plugin registry is unreachable; the app then
// installs it on first start, or falls back to trace polling.
const plugins = join(resources, "plugins");
if (!existsSync(join(plugins, WEBLOG.replace("@", "-")))) {
  try {
    mkdirSync(plugins, { recursive: true });
    run(process.env.NEXTFLOW_BIN || "nextflow", ["plugin", "install", WEBLOG], { env: { ...process.env, NXF_PLUGINS_DIR: plugins } });
  } catch {
    console.warn(`warning: could not prefetch ${WEBLOG}; the app will install it on first start`);
  }
}
writeFileSync(join(resources, "BUILD"), `${new Date().toISOString()}\n`);
