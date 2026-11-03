import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// desktop/scripts/wsl-node.sh: how `pnpm dev:win` (and "用当前代码重新构建") find a Node.js in WSL.
const SCRIPT = readFileSync(join(process.cwd(), "desktop", "scripts", "wsl-node.sh"), "utf8");

/** A stand-in `node` that reports `version` and otherwise behaves like the real one. */
function fakeNode(dir: string, version: string) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "node");
  writeFileSync(file, `#!/bin/sh
if [ "$1" = "-p" ]; then echo ${version}; exit 0; fi
if [ "$1" = "-e" ]; then exec "${process.execPath}" -e "Object.defineProperty(process.versions, 'node', { value: '${version}' }); $2"; fi
exit 1
`);
  chmodSync(file, 0o755);
  return file;
}

describe("wsl-node.sh", () => {
  let home: string;
  afterEach(() => { if (home) rmSync(home, { recursive: true, force: true }); });

  const run = (body: string, path: string) => execFileSync("sh", ["-c", `${SCRIPT}\n${body}`], {
    env: { ...process.env, HOME: home, PATH: `${path}:/usr/bin:/bin`, NVM_DIR: join(home, ".nvm") },
    encoding: "utf8",
  }).trim();

  it("finds the newest Node installed by a version manager when PATH has an old one", () => {
    home = mkdtempSync(join(tmpdir(), "nfs-node-"));
    // apt's node 18 first on PATH, as in the bug report; nvm and fnm only touch ~/.bashrc.
    const old = fakeNode(join(home, "apt-bin"), "18.19.1");
    fakeNode(join(home, ".nvm/versions/node/v99.9.0/bin"), "99.9.0");
    const newest = fakeNode(join(home, ".local/share/fnm/node-versions/v99.10.0/installation/bin"), "99.10.0");
    fakeNode(join(home, ".nvm/versions/node/v20.0.0/bin"), "20.0.0");
    expect(run(`node_ok "${old}" && echo yes || echo no`, join(home, "apt-bin"))).toBe("no");
    // 99.10.0 is newer than 99.9.0: versions compare by number, not as text.
    expect(run("find_node", join(home, "apt-bin"))).toBe(newest);
  });

  it("accepts 22.5 and refuses 22.4", () => {
    home = mkdtempSync(join(tmpdir(), "nfs-node-"));
    expect(run(`node_ok "${fakeNode(join(home, "a"), "22.5.0")}" && echo yes || echo no`, "")).toBe("yes");
    expect(run(`node_ok "${fakeNode(join(home, "b"), "22.4.1")}" && echo yes || echo no`, "")).toBe("no");
  });
});
