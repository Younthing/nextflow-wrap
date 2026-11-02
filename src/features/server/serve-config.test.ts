import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  browserLink, clearServerState, guardHosts, parseReadyLine, parseServeArgs, probeHost, readServerState, readyLine,
  serverToken, writeServerState,
} from "./serve-config";

describe("parseServeArgs", () => {
  it("defaults to a loopback server on a free port", () => {
    expect(parseServeArgs(["serve"], {})).toEqual({ host: "127.0.0.1", port: 0, allowedHosts: [], token: undefined, dataDir: undefined });
  });
  it("reads flags in both spellings and the environment", () => {
    const options = parseServeArgs(["--host", "0.0.0.0", "--port=8765", "--allowed-hosts", "gpu01, lab.example", "--data-dir", "/srv/nfs"], { NEXTFLOW_STUDIO_SESSION_TOKEN: "t".repeat(32) });
    expect(options).toMatchObject({ host: "0.0.0.0", port: 8765, allowedHosts: ["gpu01", "lab.example"], dataDir: "/srv/nfs", token: "t".repeat(32) });
  });
  it("rejects bad values and unknown flags", () => {
    expect(() => parseServeArgs(["--port", "70000"], {})).toThrow(/--port/);
    expect(() => parseServeArgs(["--token", "short"], {})).toThrow(/--token/);
    expect(() => parseServeArgs(["--host"], {})).toThrow(/需要一个值/);
    expect(() => parseServeArgs(["--verbose"], {})).toThrow(/未知选项/);
  });
});

describe("hosts", () => {
  it("adds a specific bind address to the guard and probes loopback for wildcards", () => {
    expect(guardHosts(parseServeArgs(["--host", "10.0.0.5"], {}))).toEqual(["10.0.0.5"]);
    expect(guardHosts(parseServeArgs(["--host", "0.0.0.0", "--allowed-hosts", "GPU01"], {}))).toEqual(["gpu01"]);
    expect(probeHost(parseServeArgs(["--host", "0.0.0.0"], {}))).toBe("127.0.0.1");
    expect(probeHost(parseServeArgs(["--host", "fd00::5"], {}))).toBe("[fd00::5]");
    expect(browserLink("0.0.0.0", 9, "abc")).toBe("http://127.0.0.1:9/?token=abc");
  });
});

describe("ready line", () => {
  it("round-trips and ignores other output", () => {
    const line = readyLine({ host: "127.0.0.1", port: 4100, token: "x".repeat(32), version: "0.2.0", apiVersion: 1, pid: 7, reused: false });
    expect(parseReadyLine(line)).toMatchObject({ event: "ready", port: 4100, pid: 7 });
    expect(parseReadyLine("[web] ready on 4100")).toBeUndefined();
    expect(parseReadyLine('{"event":"ready",')).toBeUndefined();
  });
});

describe("state files", () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "nfs-serve-")); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("creates the token once, private to the user, and keeps it", async () => {
    const token = serverToken(dir);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(serverToken(dir)).toBe(token);
    expect((await stat(join(dir, "server-token"))).mode & 0o777).toBe(0o600);
    expect(serverToken(dir, "given-token-1234567")).toBe("given-token-1234567");
  });

  it("only clears server.json written by the same process", async () => {
    writeServerState(dir, { pid: 42, host: "127.0.0.1", port: 9, version: "v", apiVersion: 1, startedAt: "now" });
    expect(readServerState(dir)).toMatchObject({ pid: 42, port: 9 });
    clearServerState(dir, 43);
    expect(readServerState(dir)?.pid).toBe(42);
    clearServerState(dir, 42);
    expect(readServerState(dir)).toBeUndefined();
    await expect(readFile(join(dir, "server.json"))).rejects.toThrow();
  });
});
