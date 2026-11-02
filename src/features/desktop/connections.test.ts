import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { windowsToWsl, wslPaths, wslToWindows } from "./backend-paths";
import {
  installCommand, needsInstall, parseProbe, STOP_SCRIPT, parseWslList, PROBE_SCRIPT, readConnection, readStore, serverArch, serverPackageName,
  SSH_START_SCRIPT, sshArgs,
} from "./connections";
import { parseReadyLine } from "@/features/server/serve-config";

describe("WSL paths", () => {
  it("maps drives and the distro's own files both ways", () => {
    expect(windowsToWsl("C:\\Users\\me\\reads.fq", "Ubuntu")).toBe("/mnt/c/Users/me/reads.fq");
    expect(windowsToWsl("D:\\", "Ubuntu")).toBe("/mnt/d");
    expect(windowsToWsl("\\\\wsl.localhost\\Ubuntu\\home\\me\\data", "ubuntu")).toBe("/home/me/data");
    expect(windowsToWsl("\\\\wsl$\\Ubuntu\\home\\me\\", "Ubuntu")).toBe("/home/me");
    expect(windowsToWsl("\\\\wsl.localhost\\Debian\\home\\me", "Ubuntu")).toBeUndefined();
    expect(windowsToWsl("\\\\nas\\share\\x", "Ubuntu")).toBeUndefined();
    expect(wslToWindows("/mnt/c/Users/me/reads.fq", "Ubuntu")).toBe("C:\\Users\\me\\reads.fq");
    expect(wslToWindows("/home/me/proj", "Ubuntu")).toBe("\\\\wsl.localhost\\Ubuntu\\home\\me\\proj");
    expect(wslToWindows("relative/path", "Ubuntu")).toBeUndefined();
    const map = wslPaths("Ubuntu");
    expect(map.toServer(map.toLocal("/home/me/a b.txt")!)).toBe("/home/me/a b.txt");
  });
});

describe("connections", () => {
  it("accepts the four kinds and fills labels", () => {
    expect(readConnection({ id: "a", kind: "local" })).toEqual({ id: "a", kind: "local", label: "本机" });
    expect(readConnection({ id: "b", kind: "wsl", distro: "Ubuntu-24.04" })).toMatchObject({ label: "WSL · Ubuntu-24.04" });
    expect(readConnection({ id: "c", kind: "ssh", target: "me@gpu01", port: "2222", identityFile: "~/.ssh/lab" })).toEqual({ id: "c", kind: "ssh", target: "me@gpu01", label: "me@gpu01", port: 2222, identityFile: "~/.ssh/lab" });
    expect(readConnection({ id: "d", kind: "url", url: "https://studio.lab.example/some/path" })).toMatchObject({ url: "https://studio.lab.example", label: "studio.lab.example" });
  });
  it("refuses option injection and bad values", () => {
    expect(() => readConnection({ id: "x", kind: "ssh", target: "-oProxyCommand=evil" })).toThrow();
    expect(() => readConnection({ id: "x", kind: "ssh", target: "gpu01", identityFile: "-oX" })).toThrow();
    expect(() => readConnection({ id: "x", kind: "ssh", target: "gpu01", port: 70000 })).toThrow();
    expect(() => readConnection({ id: "x", kind: "wsl", distro: "-d evil" })).toThrow();
    expect(() => readConnection({ id: "x", kind: "url", url: "file:///etc/passwd" })).toThrow();
    expect(() => readConnection({ id: "../x", kind: "local" })).toThrow();
  });
  it("keeps valid entries of a stored file and a last id that still exists", () => {
    expect(readStore({ last: "gone", connections: [{ id: "a", kind: "local" }, { id: "a", kind: "local" }, { kind: "bogus" }] })).toEqual({ connections: [{ id: "a", kind: "local", label: "本机" }] });
  });
  it("builds ssh arguments with the destination last", () => {
    const args = sshArgs({ id: "c", kind: "ssh", label: "", target: "gpu01", port: 2222, identityFile: "/k" });
    expect(args.slice(-5)).toEqual(["-p", "2222", "-i", "/k", "gpu01"]);
    expect(args).toContain("BatchMode=yes");
  });
  it("parses wsl.exe output in UTF-16 and hides Docker's distros", () => {
    const output = Buffer.from("\uFEFFUbuntu\r\ndocker-desktop\r\nDebian\r\n\r\n", "utf16le");
    expect(parseWslList(output)).toEqual(["Ubuntu", "Debian"]);
    expect(parseWslList("Ubuntu-24.04\n")).toEqual(["Ubuntu-24.04"]);
  });
  it("maps uname and names packages", () => {
    expect(serverArch("x86_64\n")).toBe("x64");
    expect(serverArch("aarch64")).toBe("arm64");
    expect(serverArch("ppc64le")).toBeUndefined();
    expect(serverPackageName("0.2.0", "x64")).toBe("nextflow-studio-server-0.2.0-linux-x64");
    expect(() => installCommand("evil; rm -rf ~", "stdin")).toThrow();
  });
});

describe("needsInstall", () => {
  it("reinstalls for another version or another build of the same version", () => {
    expect(needsInstall({}, { version: "0.2.0" })).toBe(true);
    expect(needsInstall({ version: "0.1.0", build: "a" }, { version: "0.2.0", build: "a" })).toBe(true);
    expect(needsInstall({ version: "0.2.0", build: "a" }, { version: "0.2.0", build: "b" })).toBe(true);
    expect(needsInstall({ version: "0.2.0", build: "a" }, { version: "0.2.0", build: "a" })).toBe(false);
    // A package without a build id (older builds) only compares versions.
    expect(needsInstall({ version: "0.2.0", build: "a" }, { version: "0.2.0" })).toBe(false);
  });
});

describe("remote scripts", () => {
  let home: string;
  afterEach(() => { if (home) rmSync(home, { recursive: true, force: true }); });

  /** A fake package whose `serve` prints a ready line, installed through the same command the app sends. */
  function install(version: string) {
    const name = serverPackageName(version, "x64");
    const build = mkdtempSync(join(tmpdir(), "nfs-pkg-"));
    mkdirSync(join(build, name, "bin"), { recursive: true });
    writeFileSync(join(build, name, "VERSION"), `${version}\n`);
    writeFileSync(join(build, name, "bin", "nextflow-studio"), `#!/bin/sh\necho "[web] starting" >&2\necho '{"event":"ready","host":"127.0.0.1","port":4321,"token":"tok","version":"${version}","apiVersion":1,"pid":99,"reused":false}'\nsleep 1\n`);
    chmodSync(join(build, name, "bin", "nextflow-studio"), 0o755);
    const archive = join(build, "pkg.tar.gz");
    execFileSync("tar", ["-czf", archive, "-C", build, name]);
    const result = spawnSync("sh", ["-c", installCommand(name, "stdin")], { input: readFileSync(archive), env: { ...process.env, HOME: home } });
    rmSync(build, { recursive: true, force: true });
    expect(result.status, String(result.stderr)).toBe(0);
  }

  it("probes, installs and starts a detached server that reports ready", () => {
    home = mkdtempSync(join(tmpdir(), "nfs-home-"));
    const env = { ...process.env, HOME: home };
    expect(parseProbe(execFileSync("sh", ["-s"], { input: PROBE_SCRIPT, env }).toString())).toMatchObject({ version: undefined, arch: expect.any(String) });
    install("0.2.0");
    expect(parseProbe(execFileSync("sh", ["-s"], { input: PROBE_SCRIPT, env }).toString()).version).toBe("0.2.0");
    install("0.3.0");
    expect(parseProbe(execFileSync("sh", ["-s"], { input: PROBE_SCRIPT, env }).toString()).version).toBe("0.3.0");
    const started = execFileSync("sh", ["-s"], { input: SSH_START_SCRIPT, env, timeout: 20_000 }).toString().trim();
    expect(parseReadyLine(started)).toMatchObject({ port: 4321, version: "0.3.0" });
  });

  it("stops the server recorded in server.json", () => {
    home = mkdtempSync(join(tmpdir(), "nfs-home-"));
    // Not a child of this test (which would leave a zombie that still answers kill -0): init reaps it.
    const pid = Number(execFileSync("sh", ["-c", "sleep 30 >/dev/null 2>&1 & echo $!"]).toString().trim());
    mkdirSync(join(home, ".local/share/nextflow-studio"), { recursive: true });
    writeFileSync(join(home, ".local/share/nextflow-studio/server.json"), JSON.stringify({ pid, port: 1, host: "127.0.0.1" }, null, 2));
    const started = Date.now();
    execFileSync("sh", ["-s"], { input: STOP_SCRIPT, env: { ...process.env, HOME: home }, timeout: 30_000 });
    expect(() => process.kill(pid, 0)).toThrow();
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
