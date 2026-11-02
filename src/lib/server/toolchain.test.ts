import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChecksumError, downloadVerified, managedPaths, managedToolEnv, nextflowPluginsDirectory, platformKey, pluginInstalled, seedBundledPlugins, sha256File, TOOLCHAIN } from "./toolchain";

const dirs: string[] = [];
const temp = () => { const dir = mkdtempSync(join(tmpdir(), "studio-toolchain-")); dirs.push(dir); return dir; };
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const fakePlugin = (root: string) => mkdirSync(join(root, `${TOOLCHAIN.weblog.id}-${TOOLCHAIN.weblog.version}`, "classes"), { recursive: true });

describe("toolchain", () => {
  it("pins an asset with a SHA-256 for every supported platform", () => {
    for (const key of ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64"] as const) {
      expect(TOOLCHAIN.java.assets[key].sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(TOOLCHAIN.micromamba.assets[key].sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(TOOLCHAIN.java.assets[key].url).toMatch(/^https:\/\/github\.com\//);
    }
    expect(TOOLCHAIN.nextflow.asset.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(platformKey("darwin", "arm64")).toBe("darwin-arm64");
    expect(platformKey("win32", "x64")).toBeUndefined();
  });

  it("finds the JRE home inside the unpacked archive, under Contents/Home on macOS", () => {
    const root = temp();
    mkdirSync(join(root, "jre", TOOLCHAIN.java.version, "jdk-21.0.10+7-jre"), { recursive: true });
    expect(managedPaths(root, "linux").javaHome).toBe(join(root, "jre", TOOLCHAIN.java.version, "jdk-21.0.10+7-jre"));
    expect(managedPaths(root, "darwin").javaHome).toBe(join(root, "jre", TOOLCHAIN.java.version, "jdk-21.0.10+7-jre", "Contents", "Home"));
    expect(managedPaths(temp(), "linux").javaHome).toBeUndefined();
  });

  it("points Nextflow at the managed plugin folder only when the user's folder lacks nf-weblog", () => {
    const root = temp();
    const paths = managedPaths(root);
    const home = temp();
    expect(managedToolEnv({ PATH: "/usr/bin", NXF_HOME: home }, paths)).toEqual({});
    fakePlugin(paths.plugins);
    expect(managedToolEnv({ PATH: "/usr/bin", NXF_HOME: home }, paths).NXF_PLUGINS_DIR).toBe(paths.plugins);
    fakePlugin(join(home, "plugins"));
    expect(nextflowPluginsDirectory({ NXF_HOME: home })).toBe(join(home, "plugins"));
    expect(managedToolEnv({ PATH: "/usr/bin", NXF_HOME: home }, paths).NXF_PLUGINS_DIR).toBeUndefined();
    expect(managedToolEnv({ NXF_PLUGINS_DIR: "/custom" }, paths).NXF_PLUGINS_DIR).toBeUndefined();
  });

  it("appends managed binaries after the user's PATH", () => {
    const paths = managedPaths(temp());
    mkdirSync(join(paths.micromamba, ".."), { recursive: true });
    writeFileSync(paths.micromamba, "");
    const env = managedToolEnv({ PATH: "/usr/bin" }, paths);
    expect(env.PATH?.split(":")[0]).toBe("/usr/bin");
    expect(env.MAMBA_ROOT_PREFIX).toBe(paths.mambaRoot);
  });

  it("copies a plugin bundled with the app into the managed folder", async () => {
    const bundled = temp();
    fakePlugin(bundled);
    const paths = managedPaths(temp());
    expect(await seedBundledPlugins(bundled, paths)).toBe(true);
    expect(pluginInstalled(paths.plugins)).toBe(true);
  });

  it("keeps a download only when its SHA-256 matches", async () => {
    const dir = temp();
    const source = join(dir, "source.bin");
    writeFileSync(source, "hello");
    const hash = await sha256File(source);
    const copy = async (_bin: string, args: string[]) => { writeFileSync(args[args.indexOf("-o") + 1], "hello"); };
    await downloadVerified("https://example.invalid/x", hash, join(dir, "ok.bin"), copy);
    await expect(downloadVerified("https://example.invalid/x", "0".repeat(64), join(dir, "bad.bin"), copy)).rejects.toThrow(ChecksumError);
  });
});
