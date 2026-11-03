#!/usr/bin/env node
// Builds everything the desktop app ships in resources/:
//   app-server/   Next.js standalone server (+ .next/static and public/), also packed as app-server.tar.gz
//   runner/       scripts/runner.ts bundled to one ESM file
//   plugins/      nf-weblog unpacked by `nextflow plugin install`, so live progress works offline
//   server/       the Linux server package (scripts/build-server.mjs) that WSL and SSH backends install
// and compiles the Electron main and preload scripts, with the connect page, to dist/.
//
//   node scripts/bundle.mjs              full build
//   node scripts/bundle.mjs --skip-next  reuse the last Next.js build (main/preload/runner only)
//   --skip-server                         leave resources/server/ as it is
//   --server-arm64                        also build the linux-arm64 server package
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildStandalone, bundleScript, prefetchWeblog, root, run } from "../../scripts/build-parts.mjs";
import { bundleShell } from "./bundle-shell.mjs";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const resources = join(desktop, "resources");
const skipNext = process.argv.includes("--skip-next");

if (!skipNext) {
  buildStandalone(join(resources, "app-server"));
  // electron-builder leaves node_modules out of extra resources, so the server ships as one archive that the
  // app unpacks on first start of each version (see appServerDirectory in src/main.ts).
  rmSync(join(resources, "app-server.tar.gz"), { force: true });
  run("tar", ["-czf", join(resources, "app-server.tar.gz"), "-C", resources, "app-server"]);
  // Every build gets its own id: the app unpacks the archive again when the id changes, even at the same version.
  writeFileSync(join(resources, "app-server.build"), `${new Date().toISOString().replace(/[^0-9]/g, "")}-${process.pid}\n`);
}

// The runner runs in an Electron utility process (Node with node:sqlite).
await bundleScript("runner.ts", join(resources, "runner", "runner.mjs"));

await bundleShell();

// Server packages for WSL and SSH backends, from the Next.js build above. Linux x64 always; arm64 on request.
if (!process.argv.includes("--skip-server")) {
  const packages = join(resources, "server");
  rmSync(packages, { recursive: true, force: true });
  mkdirSync(packages, { recursive: true });
  const arches = process.argv.includes("--server-arm64") ? ["x64", "arm64"] : ["x64"];
  for (const arch of arches) run("node", [join(root, "scripts", "build-server.mjs"), "--skip-next", "--arch", arch]);
  const { version } = JSON.parse(readFileSync(join(desktop, "package.json"), "utf8"));
  const current = (name) => name.startsWith(`nextflow-studio-server-${version}-linux-`) && (name.endsWith(".tar.gz") || name.endsWith(".build"));
  for (const file of readdirSync(join(root, "dist-server")).filter(current)) cpSync(join(root, "dist-server", file), join(packages, file));
}

prefetchWeblog(join(resources, "plugins"));
writeFileSync(join(resources, "BUILD"), `${new Date().toISOString()}\n`);
