import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFolder, deleteEntries, entryNameError, pasteEntries, renameEntry, workspaceSegments } from "./entries";

let root: string;
let outside: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "nfs-entries-"));
  outside = mkdtempSync(join(tmpdir(), "nfs-outside-"));
  mkdirSync(join(root, "data", "raw"), { recursive: true });
  writeFileSync(join(root, "data", "counts.tsv"), "gene\tA\n");
  writeFileSync(join(root, "data", "raw", "r1.fq"), "@r1\n");
  mkdirSync(join(root, "results"));
  writeFileSync(join(outside, "secret.txt"), "no");
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe("workspace paths", () => {
  it("refuses paths that leave the project folder", async () => {
    expect(() => workspaceSegments("../x")).toThrow(/路径无效/);
    expect(() => workspaceSegments("/etc/passwd")).toThrow(/相对于项目文件夹/);
    symlinkSync(outside, join(root, "link"));
    await expect(deleteEntries(root, ["link/secret.txt"])).rejects.toMatchObject({ status: 403 });
    expect(existsSync(join(outside, "secret.txt"))).toBe(true);
    await expect(deleteEntries(root, [""])).rejects.toMatchObject({ status: 400 });
  });

  it("checks names", () => {
    expect(entryNameError("a/b")).toMatch(/不能包含/);
    expect(entryNameError("  ")).toMatch(/不能为空/);
    expect(entryNameError("ok.csv")).toBeUndefined();
  });
});

describe("file area actions", () => {
  it("renames in place and refuses a taken name", async () => {
    expect(await renameEntry(root, "data/counts.tsv", "matrix.tsv")).toBe("data/matrix.tsv");
    expect(readFileSync(join(root, "data", "matrix.tsv"), "utf8")).toBe("gene\tA\n");
    await expect(renameEntry(root, "data/matrix.tsv", "raw")).rejects.toMatchObject({ status: 409 });
    await expect(renameEntry(root, "data/nope.tsv", "x")).rejects.toMatchObject({ status: 404 });
  });

  it("deletes files and folders with their content", async () => {
    await deleteEntries(root, ["data/raw", "data/counts.tsv"]);
    expect(existsSync(join(root, "data", "raw"))).toBe(false);
    expect(existsSync(join(root, "data", "counts.tsv"))).toBe(false);
    expect(existsSync(join(root, "data"))).toBe(true);
  });

  it("pastes copies with a numbered name next to the original", async () => {
    expect(await pasteEntries(root, ["data/counts.tsv"], "data", "copy")).toEqual(["data/counts (1).tsv"]);
    expect(await pasteEntries(root, ["data/raw"], "results", "copy")).toEqual(["results/raw"]);
    expect(readFileSync(join(root, "results", "raw", "r1.fq"), "utf8")).toBe("@r1\n");
    expect(existsSync(join(root, "data", "raw", "r1.fq"))).toBe(true);
  });

  it("moves entries, leaves one already in place alone, and refuses a folder into itself", async () => {
    expect(await pasteEntries(root, ["data/counts.tsv"], "", "move")).toEqual(["counts.tsv"]);
    expect(existsSync(join(root, "data", "counts.tsv"))).toBe(false);
    expect(await pasteEntries(root, ["counts.tsv"], "", "move")).toEqual(["counts.tsv"]);
    await expect(pasteEntries(root, ["data"], "data/raw", "move")).rejects.toMatchObject({ status: 400 });
    await expect(pasteEntries(root, ["data"], "data", "copy")).rejects.toMatchObject({ status: 400 });
    await expect(pasteEntries(root, ["counts.tsv"], "data/raw/r1.fq", "copy")).rejects.toMatchObject({ status: 400 });
  });

  it("creates a folder", async () => {
    expect(await createFolder(root, "data", "qc")).toBe("data/qc");
    await expect(createFolder(root, "data", "qc")).rejects.toMatchObject({ status: 409 });
  });
});
