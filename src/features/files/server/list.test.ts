import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listDirectory } from "./list";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("listDirectory", () => {
  it("lists folders first, hides dotfiles, follows symlinks and reports sizes", async () => {
    const root = mkdtempSync(join(tmpdir(), "studio-fs-"));
    dirs.push(root);
    mkdirSync(join(root, "filtered_feature_bc_matrix"));
    writeFileSync(join(root, "pbmc3k.h5ad"), "12345");
    writeFileSync(join(root, ".DS_Store"), "");
    symlinkSync(join(root, "pbmc3k.h5ad"), join(root, "link.h5ad"));
    symlinkSync(join(root, "missing"), join(root, "broken"));
    const listing = await listDirectory(root, { home: root });
    expect(listing.entries.map((entry) => entry.name)).toEqual(["filtered_feature_bc_matrix", "link.h5ad", "pbmc3k.h5ad"]);
    expect(listing.entries[2]).toMatchObject({ kind: "file", size: 5 });
    expect(listing.parent).toBeDefined();
  });

  it("opens the containing folder for a file and the home folder for a relative path", async () => {
    const root = mkdtempSync(join(tmpdir(), "studio-fs-"));
    dirs.push(root);
    writeFileSync(join(root, "a.txt"), "");
    expect((await listDirectory(join(root, "a.txt"))).path).toBe(root);
    expect((await listDirectory("relative/path", { home: root })).path).toBe(root);
  });
});
