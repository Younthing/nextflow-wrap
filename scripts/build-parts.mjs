// Pieces shared by the desktop bundle (desktop/scripts/bundle.mjs) and the standalone server package
// (scripts/build-server.mjs): the Next.js standalone server, the bundled runner and serve entry, and nf-weblog.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import nextEnv from "@next/env";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const WEBLOG = "nf-weblog@1.2.0";

export const run = (bin, args, options = {}) => execFileSync(bin, args, { stdio: "inherit", cwd: root, ...options });

/** `pnpm build` as a standalone server, copied with its static files to `target`. */
export function buildStandalone(target, { skipBuild = false } = {}) {
  if (!skipBuild) run("pnpm", ["build"], { env: { ...process.env, NEXT_OUTPUT: "standalone", NEXT_PUBLIC_API_MOCKING: "disabled" } });
  rmSync(target, { recursive: true, force: true });
  cpSync(join(root, ".next", "standalone"), target, { recursive: true, verbatimSymlinks: true });
  cpSync(join(root, ".next", "static"), join(target, ".next", "static"), { recursive: true });
  cpSync(join(root, "public"), join(target, "public"), { recursive: true });
}

/** A script under scripts/ bundled to one ESM file with the @/ alias resolved (runner, serve). */
export async function bundleScript(entry, outfile) {
  const { combinedEnv } = nextEnv.loadEnvConfig(root, false);
  await build({
    entryPoints: [join(root, "scripts", entry)],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    define: { "process.env.NEXT_PUBLIC_PRODUCT_THEME": JSON.stringify(combinedEnv.NEXT_PUBLIC_PRODUCT_THEME ?? "") },
    tsconfig: join(root, "tsconfig.json"),
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    logLevel: "info",
  });
}

/**
 * nf-weblog for offline live progress. Skipped (with a warning) when the plugin registry is unreachable; the app
 * then installs it on first start, or falls back to trace polling.
 */
export function prefetchWeblog(plugins) {
  if (existsSync(join(plugins, WEBLOG.replace("@", "-")))) return;
  try {
    mkdirSync(plugins, { recursive: true });
    run(process.env.NEXTFLOW_BIN || "nextflow", ["plugin", "install", WEBLOG], { env: { ...process.env, NXF_PLUGINS_DIR: plugins } });
  } catch {
    console.warn(`warning: could not prefetch ${WEBLOG}; the app will install it on first start`);
  }
}
