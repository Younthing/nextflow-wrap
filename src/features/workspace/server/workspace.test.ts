import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ensureWorkspace, WORKSPACE_FOLDERS, WorkspaceError } from "./workspace";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
const temp = () => {
  const directory = mkdtempSync(join(tmpdir(), "studio-ws-"));
  directories.push(directory);
  return directory;
};

describe("ensureWorkspace", () => {
  it("creates the manifest, .gitignore and standard folders once", async () => {
    const root = join(temp(), "pbmc-study");
    const first = await ensureWorkspace(root);
    expect(first).toMatchObject({ formatVersion: 1, name: "pbmc-study" });
    for (const folder of WORKSPACE_FOLDERS) expect(existsSync(join(root, folder))).toBe(true);
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toContain(".studio/");
    writeFileSync(join(root, ".gitignore"), "mine\n");
    const again = await ensureWorkspace(root);
    expect(again.id).toBe(first.id);
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe("mine\n");
  });

  it("refuses a workspace written by a newer app", async () => {
    const root = temp();
    writeFileSync(join(root, "studio.json"), JSON.stringify({ formatVersion: 99, id: "ws_x", name: "x" }));
    await expect(ensureWorkspace(root)).rejects.toThrow(WorkspaceError);
  });
});
