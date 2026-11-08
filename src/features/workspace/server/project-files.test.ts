import { mkdtempSync, readFileSync, rmSync, writeFileSync, renameSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectFiles } from "./project-files";
import { ProjectDocuments } from "./project-documents";
import { emptyWorkflow } from "@/features/workflow/document";

const roots: string[] = [];
const root = () => { const path = mkdtempSync(join(tmpdir(), "studio-files-")); roots.push(path); return path; };
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe("project files", () => {
  it("restores known documents in data folders and follows their application-managed moves", () => {
    const path = root();
    const docs = new ProjectDocuments(path, "project");
    docs.write({ ...emptyWorkflow("nested"), filePath: "data/analysis.workflow.json" }, "workflow");
    const reopened = new ProjectDocuments(path, "project");
    expect(reopened.get("nested", "workflow")?.filePath).toBe("data/analysis.workflow.json");
    renameSync(join(path, "data/analysis.workflow.json"), join(path, "data/renamed.workflow.json"));
    reopened.moved([{ from: "data/analysis.workflow.json", to: "data/renamed.workflow.json" }]);
    expect(new ProjectDocuments(path, "project").get("nested", "workflow")?.filePath).toBe("data/renamed.workflow.json");
  });
  it("does not let a malformed document prevent opening other project files", () => {
    const docs = new ProjectDocuments(root(), "project");
    docs.write({ ...emptyWorkflow("valid"), filePath: "valid.workflow.json" }, "workflow");
    writeFileSync(docs.files.resolve("broken.workflow.json"), "{");
    expect(docs.get("valid", "workflow")?.id).toBe("valid");
    expect(() => docs.open("broken.workflow.json")).toThrow();
    expect(docs.files.read("broken.workflow.json").content).toBe("{");
  });
  it("rejects a stale save and never resurrects an externally deleted file", () => {
    const files = new ProjectFiles(root());
    const first = files.write("analysis/结果.txt", "first", null);
    writeFileSync(files.resolve(first.path), "external");
    expect(() => files.write(first.path, "stale", first.version)).toThrow("外部被修改");
    expect(files.read(first.path).content).toBe("external");
    const current = files.read(first.path);
    rmSync(files.resolve(first.path));
    expect(() => files.write(first.path, "resurrect", current.version)).toThrow("已删除");
  });

  it("prevents traversal and mutations through external symlinks", () => {
    const files = new ProjectFiles(root());
    const outside = root();
    symlinkSync(outside, join(files.root, "external"), "junction");
    expect(() => files.write("../escape", "bad", null)).toThrow("不能离开");
    expect(() => files.write("external/file", "bad", null)).toThrow("符号链接");
  });

  it("reopens nested workflow files without any database, and follows moves", () => {
    const path = root();
    const docs = new ProjectDocuments(path, "first-window");
    const saved = docs.write({ ...emptyWorkflow("wf_one"), filePath: "experiment/one.workflow.json" }, "workflow");
    expect(saved.fileVersion).toBeTruthy();
    expect(readFileSync(join(path, saved.filePath!), "utf8")).not.toContain("first-window");
    mkdirSync(join(path, "nested"));
    renameSync(join(path, saved.filePath!), join(path, "nested/two.workflow.json"));
    const reopened = new ProjectDocuments(path, "second-window");
    expect(reopened.get(saved.id, "workflow")?.filePath).toBe("nested/two.workflow.json");
    rmSync(join(path, "nested/two.workflow.json"));
    expect(reopened.get(saved.id, "workflow")).toBeUndefined();
  });

  it("assigns copied documents distinct identities", () => {
    const docs = new ProjectDocuments(root(), "project");
    docs.write({ ...emptyWorkflow("same"), filePath: "a.workflow.json" }, "workflow");
    writeFileSync(docs.files.resolve("0-copy.workflow.json"), docs.files.read("a.workflow.json").content);
    const documents = docs.list("workflow");
    expect(new Set(documents.map((doc) => doc.id)).size).toBe(2);
    expect(docs.get("same", "workflow")?.filePath).toBe("a.workflow.json");
    expect(new ProjectDocuments(docs.files.root, "project").list("workflow").map((doc) => doc.id).sort()).toEqual(documents.map((doc) => doc.id).sort());
  });
});
