import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { DATA_ENTRIES as BUILD_DATA_ENTRIES, syncTree } from "../../../desktop/scripts/dev-server-build.mjs";
import { DATA_ENTRIES } from "./connections";

// The WSL build behind `pnpm dev:win` and "用当前代码重新构建": desktop/scripts/wsl-bootstrap.sh and dev-server-build.mjs.
const BOOTSTRAP = readFileSync(join(process.cwd(), "desktop", "scripts", "wsl-bootstrap.sh"), "utf8");

let dirs: string[] = [];
const temp = (prefix: string) => { const dir = mkdtempSync(join(tmpdir(), prefix)); dirs.push(dir); return dir; };
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs = []; });

const write = (file: string, text: string) => { mkdirSync(join(file, ".."), { recursive: true }); writeFileSync(file, text); };

describe("syncTree", () => {
  it("copies changed files, removes deleted ones and leaves excluded folders alone", () => {
    const src = temp("nfs-src-");
    const dst = temp("nfs-dst-");
    write(join(src, "package.json"), "{}");
    write(join(src, "src/a.ts"), "a");
    write(join(src, "src/b.ts"), "b");
    write(join(src, "node_modules/x/index.js"), "windows copy");
    write(join(src, ".git/HEAD"), "ref");
    write(join(src, "desktop/resources/server/pkg.tar.gz"), "pkg");
    write(join(src, "nxf-tmp.abc"), "");
    expect(syncTree(src, dst)).toEqual({ copied: 3, removed: 0 });
    expect(existsSync(join(dst, "node_modules"))).toBe(false);
    expect(existsSync(join(dst, ".git"))).toBe(false);
    expect(existsSync(join(dst, "desktop/resources"))).toBe(false);
    expect(existsSync(join(dst, "nxf-tmp.abc"))).toBe(false);

    // The copy's own node_modules and .next stay; unchanged files are not copied again.
    write(join(dst, "node_modules/linux/index.js"), "linux");
    write(join(dst, ".next/cache/x"), "cache");
    expect(syncTree(src, dst)).toEqual({ copied: 0, removed: 0 });

    rmSync(join(src, "src/b.ts"));
    write(join(src, "src/a.ts"), "changed");
    utimesSync(join(src, "src/a.ts"), new Date(), new Date(Date.now() + 5_000));
    expect(syncTree(src, dst)).toEqual({ copied: 1, removed: 1 });
    expect(readFileSync(join(dst, "src/a.ts"), "utf8")).toBe("changed");
    expect(existsSync(join(dst, "src/b.ts"))).toBe(false);
    expect(existsSync(join(dst, "node_modules/linux/index.js"))).toBe(true);
    expect(existsSync(join(dst, ".next/cache/x"))).toBe(true);
    expect(statSync(join(dst, "src/a.ts")).mtimeMs).toBeCloseTo(statSync(join(src, "src/a.ts")).mtimeMs, -1);
  });

  it("clears the same data entries as the app", () => {
    expect(BUILD_DATA_ENTRIES).toEqual([...DATA_ENTRIES]);
  });
});

describe("wsl-bootstrap.sh", () => {
  /** A checkout with the NODE_VERSION line and a dev-server-build.mjs that only reports how it was started. */
  function checkout() {
    const src = temp("nfs-checkout-");
    write(join(src, "scripts/build-server.mjs"), 'const NODE_VERSION = "v99.0.0";\r\n');
    write(join(src, "desktop/scripts/dev-server-build.mjs"), "");
    return src;
  }

  /** A nodejs.org look-alike (file://) whose release is a `node` that prints its arguments. */
  function mirror(arch: string, corrupt = false) {
    const root = temp("nfs-mirror-");
    const name = `node-v99.0.0-linux-${arch}`;
    const build = temp("nfs-node-");
    write(join(build, name, "bin/node"), '#!/bin/sh\n[ "$1" = "-e" ] && exit 0\necho "node-ran $*"\n');
    chmodSync(join(build, name, "bin/node"), 0o755);
    mkdirSync(join(root, "v99.0.0"));
    const archive = join(root, "v99.0.0", `${name}.tar.gz`);
    execFileSync("tar", ["-czf", archive, "-C", build, name]);
    const sum = corrupt ? "0".repeat(64) : createHash("sha256").update(readFileSync(archive)).digest("hex");
    writeFileSync(join(root, "v99.0.0", "SHASUMS256.txt"), `${sum}  ${name}.tar.gz\n`);
    return root;
  }

  const arch = () => (["aarch64", "arm64"].includes(execFileSync("uname", ["-m"], { encoding: "utf8" }).trim()) ? "arm64" : "x64");

  function bootstrap(home: string, src: string, mirrorRoot: string, extra: string[] = []) {
    // As dev-win.mjs runs it: /bin/sh -s, script on stdin. A ~/.profile and ~/.bashrc that would hang are never read.
    return spawnSync("/bin/sh", ["-s", "--", src, ...extra], {
      input: BOOTSTRAP,
      encoding: "utf8",
      timeout: 60_000,
      // Only these variables: nothing of this machine's environment leaks in.
      env: { PATH: "/usr/bin:/bin", HOME: home, NEXTFLOW_STUDIO_NODE_MIRROR: `file://${mirrorRoot}` } as unknown as NodeJS.ProcessEnv,
    });
  }

  it("installs the pinned Node.js into our folder once and hands over to dev-server-build.mjs", () => {
    const home = temp("nfs-home-");
    write(join(home, ".profile"), "touch \"$HOME/profile-was-read\"; sleep 600\n");
    write(join(home, ".bashrc"), "touch \"$HOME/bashrc-was-read\"; sleep 600\n");
    const src = checkout();
    const result = bootstrap(home, src, mirror(arch()), ["--fresh"]);
    expect(result.status, result.stderr).toBe(0);
    const tools = join(home, ".local/share/nextflow-studio/toolchain/build");
    expect(result.stdout).toContain(`node-ran ${join(src, "desktop/scripts/dev-server-build.mjs")} --src ${src} --tools ${tools} --node-dir ${tools}/node-v99.0.0-linux-${arch()} --arch ${arch()} --fresh`);
    expect(existsSync(join(home, "profile-was-read"))).toBe(false);
    expect(existsSync(join(home, "bashrc-was-read"))).toBe(false);

    // Second run: no download (the mirror is gone).
    const again = bootstrap(home, src, "/nonexistent");
    expect(again.status, again.stderr).toBe(0);
    expect(again.stdout).not.toContain("安装构建用的 Node.js");
  });

  it("refuses a download whose checksum does not match", () => {
    const home = temp("nfs-home-");
    const result = bootstrap(home, checkout(), mirror(arch(), true));
    expect(result.status).toBe(3);
    expect(result.stderr).toContain("校验失败");
    expect(existsSync(join(home, ".local/share/nextflow-studio/toolchain/build", `node-v99.0.0-linux-${arch()}`))).toBe(false);
  });
});
