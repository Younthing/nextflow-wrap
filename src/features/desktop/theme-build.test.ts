import { execFileSync } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";

const bundleScript = pathToFileURL(join(process.cwd(), "desktop/scripts/bundle-shell.mjs")).href;
const desktop = join(process.cwd(), "desktop");
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function builtTheme(files: Record<string, string>, override?: string) {
  const dir = await mkdtemp(join(tmpdir(), "nfs-theme-build-"));
  directories.push(dir);
  for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), content);
  const outdir = join(dir, "dist");
  await copyFile(join(desktop, "package.json"), join(dir, "package.json"));
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production" };
  delete env.NEXT_PUBLIC_PRODUCT_THEME;
  if (override !== undefined) env.NEXT_PUBLIC_PRODUCT_THEME = override;
  // A separate process models CLI/dev/CI builds and isolates @next/env's process-level cache.
  execFileSync(process.execPath, ["--input-type=module", "-e", `
    import { bundleShell } from ${JSON.stringify(bundleScript)};
    import { createRequire } from 'node:module';
    import { writeFileSync } from 'node:fs';
    await bundleShell(${JSON.stringify({ outdir, envDir: dir })});
    const requireDesktop = createRequire(${JSON.stringify(join(desktop, "package.json"))});
    const requireBuilder = createRequire(requireDesktop.resolve('electron-builder'));
    const { getConfig, validateConfiguration } = requireBuilder('app-builder-lib/out/util/config/config');
    const config = await getConfig(${JSON.stringify(dir)}, ${JSON.stringify(join(desktop, "electron-builder.cjs"))});
    await validateConfiguration(config, { debugLogger: { isEnabled: false } });
    writeFileSync(${JSON.stringify(join(dir, "packaging.json"))}, JSON.stringify(config));
  `], { cwd: dir, env, stdio: "pipe" });
  const code = await readFile(join(outdir, "main.js"), "utf8");
  // Evaluate the theme registry emitted into the real main bundle, without starting Electron/backends.
  const start = code.indexOf("var themes_default");
  const end = code.indexOf("\n}", code.indexOf("function getProductTheme", start)) + 2;
  const theme = runInNewContext(`${code.slice(start, end)}\ngetProductTheme()`, { process: { env: {} } });
  const config = JSON.parse(await readFile(join(dir, "packaging.json"), "utf8"));
  const html = await readFile(join(outdir, "connect", "index.html"), "utf8");
  return { theme, code, config, html, outdir };
}

describe("desktop product theme build", () => {
  it("keeps the .env theme in the startup bundle when the installed app has no runtime environment", async () => {
    const { theme, code, config, html, outdir } = await builtTheme({ ".env": "NEXT_PUBLIC_PRODUCT_THEME=fluora    \nPRIVATE_BUILD_SECRET=never-ship-this-value\n" });
    expect(theme.id).toBe("fluora");
    expect(theme.displayName).toBe("Fluora");
    expect(code).not.toContain("never-ship-this-value");
    expect(config.productName).toBe(theme.displayName);
    expect(config.extraMetadata.productName).toBe(theme.displayName);
    expect(config.artifactName).toBe("Fluora-${version}-${os}-${arch}.${ext}");
    expect(config.copyright).toBe(theme.copyright);
    expect(config.appId).toBe("io.nextflowstudio.desktop");
    expect(config.publish).toMatchObject({ owner: "Younthing", repo: "nextflow-wrap" });
    expect(config.linux.executableName).toBe("nextflow-studio-desktop");
    expect(config.extraResources).toEqual(expect.arrayContaining([
      expect.objectContaining({ to: "brand" }), expect.objectContaining({ to: "server" }),
    ]));
    expect(html).toContain("<title>Fluora</title>");
    expect(html).not.toContain("Nextflow Studio");
    expect(await readFile(join(outdir, "brand/icon.png"))).toEqual(await readFile(config.icon));
    expect(await readFile(join(outdir, "brand/trayTemplate.png"))).toEqual(await readFile(join(process.cwd(), "public", theme.trayIcon)));
  });

  it("uses production-local values before .env and process overrides before files", async () => {
    const files = { ".env": "NEXT_PUBLIC_PRODUCT_THEME=nextflow-studio\n", ".env.production.local": "NEXT_PUBLIC_PRODUCT_THEME=fluora\n" };
    expect((await builtTheme(files)).theme.id).toBe("fluora");
    expect((await builtTheme(files, "nextflow-studio")).theme.id).toBe("nextflow-studio");
  });

  it("keeps the default theme when no theme is configured", async () => {
    const { theme, config } = await builtTheme({});
    expect(theme.id).toBe("nextflow-studio");
    expect(config.productName).toBe("Nextflow Studio");
    expect(config.artifactName).toBe("Nextflow-Studio-${version}-${os}-${arch}.${ext}");
  });

  it("rejects an unknown brand instead of silently shipping the default", async () => {
    await expect(builtTheme({}, "floura")).rejects.toThrow("Unknown NEXT_PUBLIC_PRODUCT_THEME");
  });

  it("rejects packaging a shell built for a different brand", async () => {
    const { outdir } = await builtTheme({}, "fluora");
    const configFile = join(desktop, "electron-builder.cjs");
    expect(() => execFileSync(process.execPath, ["-e", `
      require(${JSON.stringify(configFile)})({ projectDir: ${JSON.stringify(join(outdir, ".."))} })
        .catch((error) => { console.error(error.message); process.exit(1); });
    `], { env: { ...process.env, NEXT_PUBLIC_PRODUCT_THEME: "nextflow-studio" }, stdio: "pipe" }))
      .toThrow("Bundle the desktop shell");
  });
});
