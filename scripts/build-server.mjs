#!/usr/bin/env node
// Builds the standalone server package: everything `nextflow-studio serve` needs on a Linux machine (WSL2 or a
// server), with its own Node so the target needs nothing but Java for Nextflow.
//
//   dist-server/nextflow-studio-server-<version>-linux-<arch>/
//     bin/nextflow-studio   entry point (sh): runs serve.mjs with the bundled Node
//     serve.mjs             web server + runner supervisor (scripts/serve.ts)
//     app-server/           Next.js standalone server
//     runner/runner.mjs     Nextflow runner (scripts/runner.ts)
//     plugins/              nf-weblog, for offline live progress
//     node/                 Node.js runtime (omitted with --no-node; the system `node` is used then)
//     VERSION
//   dist-server/nextflow-studio-server-<version>-linux-<arch>.tar.gz
//
//   node scripts/build-server.mjs                 linux-x64 with Node
//   node scripts/build-server.mjs --arch arm64
//   node scripts/build-server.mjs --skip-next     reuse the last Next.js standalone build
//   node scripts/build-server.mjs --no-node       rely on Node >= 22.5 on the target
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { buildStandalone, bundleScript, prefetchWeblog, root, run } from "./build-parts.mjs";

// Node 22.5+ has node:sqlite; keep this on a release the app is tested with.
const NODE_VERSION = "v24.7.0";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const arch = option("--arch", process.arch === "arm64" ? "arm64" : "x64");
if (!["x64", "arm64"].includes(arch)) throw new Error(`unsupported --arch ${arch}`);

const desktopVersion = JSON.parse(readFileSync(join(root, "desktop", "package.json"), "utf8")).version;
const version = option("--version", desktopVersion);
const name = `nextflow-studio-server-${version}-linux-${arch}`;
const out = join(root, "dist-server");
const target = join(out, name);
// Outside the checkout: Next's file tracing copies dot-folders such as .cache into the standalone server.
const cache = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "nextflow-studio-build");

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });

buildStandalone(join(target, "app-server"), { skipBuild: flag("--skip-next") && existsSync(join(root, ".next", "standalone")) });
await bundleScript("runner.ts", join(target, "runner", "runner.mjs"));
await bundleScript("serve.ts", join(target, "serve.mjs"));
prefetchWeblog(join(cache, "plugins"));
if (existsSync(join(cache, "plugins"))) cpSync(join(cache, "plugins"), join(target, "plugins"), { recursive: true });
writeFileSync(join(target, "VERSION"), `${version}\n`);

mkdirSync(join(target, "bin"), { recursive: true });
writeFileSync(join(target, "bin", "nextflow-studio"), `#!/bin/sh
# Nextflow Studio server. Usage: nextflow-studio serve [--host ADDR] [--port N] [--data-dir DIR]
set -e
DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
NODE="$DIR/node/bin/node"
[ -x "$NODE" ] || NODE=node
exec "$NODE" "$DIR/serve.mjs" "$@"
`);
chmodSync(join(target, "bin", "nextflow-studio"), 0o755);

// curl, not fetch: it honours HTTPS_PROXY on build machines behind a proxy.
const download = (url, file) => run("curl", ["-fsSL", "--retry", "3", "-o", file, url]);

function fetchNode() {
  const file = `node-${NODE_VERSION}-linux-${arch}.tar.xz`;
  const archive = join(cache, file);
  const base = `https://nodejs.org/dist/${NODE_VERSION}`;
  mkdirSync(cache, { recursive: true });
  const sumsFile = join(cache, `SHASUMS256-${NODE_VERSION}.txt`);
  if (!existsSync(sumsFile)) download(`${base}/SHASUMS256.txt`, sumsFile);
  const expected = readFileSync(sumsFile, "utf8").split("\n").find((line) => line.endsWith(`  ${file}`))?.split(" ")[0];
  if (!expected) throw new Error(`no checksum for ${file}`);
  const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
  if (!existsSync(archive) || sha(archive) !== expected) {
    download(`${base}/${file}`, archive);
    if (sha(archive) !== expected) { rmSync(archive, { force: true }); throw new Error(`checksum mismatch for ${file}`); }
  }
  const node = join(target, "node");
  mkdirSync(node, { recursive: true });
  run("tar", ["-xJf", archive, "-C", node, "--strip-components=1", `node-${NODE_VERSION}-linux-${arch}/bin/node`, `node-${NODE_VERSION}-linux-${arch}/LICENSE`]);
}
if (!flag("--no-node")) fetchNode();

rmSync(`${target}.tar.gz`, { force: true });
run("tar", ["-czf", `${target}.tar.gz`, "-C", out, name]);
console.log(`\n${target}.tar.gz`);
