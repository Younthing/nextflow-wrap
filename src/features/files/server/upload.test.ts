import { mkdtemp, readFile, readdir, rm, symlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { numberedName, reserveUpload, uploadSegments, writeUpload } from "./upload";

const stream = (text: string) => new Blob([text]).stream();

describe("upload paths", () => {
  it("splits on either separator and refuses traversal", () => {
    expect(uploadSegments("reads/R1.fq")).toEqual(["reads", "R1.fq"]);
    expect(uploadSegments("reads\\sub\\R1.fq")).toEqual(["reads", "sub", "R1.fq"]);
    expect(() => uploadSegments("../etc/passwd")).toThrow();
    expect(() => uploadSegments("a/./b")).toThrow();
    expect(() => uploadSegments("")).toThrow();
    expect(() => uploadSegments("a\u0000b")).toThrow();
  });
  it("numbers clashes before the extension of files only", () => {
    expect(numberedName("reads.fq", 0, "file")).toBe("reads.fq");
    expect(numberedName("reads.fq", 2, "file")).toBe("reads (2).fq");
    expect(numberedName("sample.v1", 1, "directory")).toBe("sample.v1 (1)");
    expect(numberedName(".env", 1, "file")).toBe(".env (1)");
  });
});

describe("reserve and write", () => {
  let project: string;
  beforeEach(async () => { project = await mkdtemp(join(tmpdir(), "nfs-upload-")); });
  afterEach(async () => { await rm(project, { recursive: true, force: true }); });

  it("reserves free names in data/ and streams a file into the reservation", async () => {
    const first = await reserveUpload(project, "reads.fq", "file");
    const second = await reserveUpload(project, "reads.fq", "file");
    expect([first.name, second.name]).toEqual(["reads.fq", "reads (1).fq"]);
    const written = await writeUpload(project, second.name, stream("ACGT"));
    expect(written.bytes).toBe(4);
    expect(await readFile(join(project, "data", "reads (1).fq"), "utf8")).toBe("ACGT");
  });

  it("writes nested files under a reserved folder", async () => {
    const folder = await reserveUpload(project, "run1", "directory");
    await writeUpload(project, `${folder.name}/lane1/R1.fq`, stream("x"));
    expect(await readFile(join(project, "data", "run1", "lane1", "R1.fq"), "utf8")).toBe("x");
  });

  it("refuses paths that were not reserved or that leave data/", async () => {
    await expect(writeUpload(project, "other.txt", stream("x"))).rejects.toMatchObject({ status: 409 });
    await expect(writeUpload(project, "../escape.txt", stream("x"))).rejects.toMatchObject({ status: 400 });
    const outside = await mkdtemp(join(tmpdir(), "nfs-outside-"));
    try {
      await mkdir(join(project, "data"), { recursive: true });
      await symlink(outside, join(project, "data", "link"));
      await expect(writeUpload(project, "link/x.txt", stream("x"))).rejects.toMatchObject({ status: 409 });
      const folder = await reserveUpload(project, "f", "directory");
      await symlink(outside, join(project, "data", folder.name, "inner"));
      await expect(writeUpload(project, `${folder.name}/inner/x.txt`, stream("x"))).rejects.toMatchObject({ status: 403 });
      expect(await readdir(outside)).toEqual([]);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("stops at the size limit and leaves no partial file", async () => {
    const reserved = await reserveUpload(project, "big.bin", "file");
    await expect(writeUpload(project, reserved.name, stream("123456"), 4)).rejects.toMatchObject({ status: 413 });
    expect((await readdir(join(project, "data"))).filter((name) => name.endsWith(".part"))).toEqual([]);
  });
});
