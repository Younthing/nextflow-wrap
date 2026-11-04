import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";

const bundleScript = pathToFileURL(join(process.cwd(), "desktop/scripts/bundle-shell.mjs")).href;
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function builtTheme(files: Record<string, string>, override?: string) {
  const dir = await mkdtemp(join(tmpdir(), "nfs-theme-build-"));
  directories.push(dir);
  for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), content);
  const outdir = join(dir, "dist");
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production" };
  delete env.NEXT_PUBLIC_PRODUCT_THEME;
  if (override !== undefined) env.NEXT_PUBLIC_PRODUCT_THEME = override;
  // A separate process models CLI/dev/CI builds and isolates @next/env's process-level cache.
  execFileSync(process.execPath, ["--input-type=module", "-e", `
    import { bundleShell } from ${JSON.stringify(bundleScript)};
    await bundleShell(${JSON.stringify({ outdir, envDir: dir })});
  `], { cwd: dir, env, stdio: "pipe" });
  const code = await readFile(join(outdir, "main.js"), "utf8");
  // Evaluate the theme registry emitted into the real main bundle, without starting Electron/backends.
  const start = code.indexOf("var DEFAULT_PRODUCT_THEME");
  const end = code.indexOf("\n}", code.indexOf("function getProductTheme", start)) + 2;
  const theme = runInNewContext(`${code.slice(start, end)}\ngetProductTheme()`, { process: { env: {} } });
  return { theme, code };
}

describe("desktop product theme build", () => {
  it("keeps the .env theme in the startup bundle when the installed app has no runtime environment", async () => {
    const { theme, code } = await builtTheme({ ".env": "NEXT_PUBLIC_PRODUCT_THEME=fluora    \nPRIVATE_BUILD_SECRET=never-ship-this-value\n" });
    expect(theme.id).toBe("fluora");
    expect(theme.displayName).toBe("Fluora");
    expect(code).not.toContain("never-ship-this-value");
  });

  it("uses production-local values before .env and process overrides before files", async () => {
    const files = { ".env": "NEXT_PUBLIC_PRODUCT_THEME=nextflow-studio\n", ".env.production.local": "NEXT_PUBLIC_PRODUCT_THEME=fluora\n" };
    expect((await builtTheme(files)).theme.id).toBe("fluora");
    expect((await builtTheme(files, "nextflow-studio")).theme.id).toBe("nextflow-studio");
  });

  it("keeps the default theme when no theme is configured", async () => {
    expect((await builtTheme({})).theme.id).toBe("nextflow-studio");
  });
});
