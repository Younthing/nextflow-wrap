import { mkdtempSync, mkdirSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { StudioStore } from "@/lib/server/database";
import { projectIdForPath } from "../projects";
import { closeProject, createProject, forgetProject, listProjects, openProject, reopenProject, type ProjectContext } from "./projects";

let root: string;
let db: StudioStore;
let context: ProjectContext;
let tick = 0;


beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "projects-"));
  db = new StudioStore(":memory:");
  tick = 0;
  context = { db, exampleDir: join(root, "data", "projects", "example"), now: () => new Date(Date.UTC(2026, 10, 2, 9, tick++)).toISOString() };
});
afterEach(() => db.close());

describe("projects", () => {
  it("create a scaffolded folder and open it", async () => {
    const project = await createProject(context, { name: "PBMC 图谱", parent: root });
    expect(project).toMatchObject({ name: "PBMC 图谱", path: join(root, "PBMC 图谱"), id: projectIdForPath(join(root, "PBMC 图谱")) });
    expect(existsSync(join(root, "PBMC 图谱", "data"))).toBe(true);
    expect(existsSync(join(root, "PBMC 图谱", "results"))).toBe(true);
    expect(await listProjects(context)).toMatchObject({ current: project.id, projects: [project] });
  });

  it("refuse a name that is a path, a missing parent and a non-empty folder", async () => {
    await expect(createProject(context, { name: "a/b", parent: root })).rejects.toMatchObject({ status: 400 });
    await expect(createProject(context, { name: "x", parent: join(root, "missing") })).rejects.toMatchObject({ status: 400 });
    await expect(createProject(context, { name: "x", parent: "relative" })).rejects.toMatchObject({ status: 400 });
    mkdirSync(join(root, "busy"));
    writeFileSync(join(root, "busy", "notes.txt"), "hi");
    await expect(createProject(context, { name: "busy", parent: root })).rejects.toMatchObject({ status: 409 });
  });

  it("open a folder as the same project every time", async () => {
    mkdirSync(join(root, "visium-pilot"));
    const first = await openProject(context, join(root, "visium-pilot"));
    const second = await openProject(context, `${join(root, "visium-pilot")}/`);
    expect(first.name).toBe("visium-pilot");
    expect(second.id).toBe(first.id);
    expect(second.openedAt > first.openedAt).toBe(true);
    expect((await listProjects(context)).projects).toHaveLength(1);
    await expect(openProject(context, join(root, "nope"))).rejects.toMatchObject({ status: 404 });
  });

  it("list the most recently opened first and reopen from the list", async () => {
    const a = await createProject(context, { name: "a", parent: root });
    const b = await createProject(context, { name: "b", parent: root });
    expect((await listProjects(context)).projects.map((p) => p.id)).toEqual([b.id, a.id]);
    await reopenProject(context, a.id);
    expect(await listProjects(context)).toMatchObject({ current: a.id, projects: [{ id: a.id }, { id: b.id }] });
  });

  it("close and forget without touching the folder", async () => {
    const a = await createProject(context, { name: "a", parent: root });
    closeProject(context);
    expect((await listProjects(context)).current).toBeUndefined();
    await reopenProject(context, a.id);
    forgetProject(context, a.id);
    expect(await listProjects(context)).toEqual({ projects: [], current: undefined });
    expect(existsSync(a.path)).toBe(true);
    expect(() => forgetProject(context, a.id)).toThrow();
  });

  it("report a recent project whose folder is gone", async () => {
    mkdirSync(join(root, "moved"));
    const project = await openProject(context, join(root, "moved"));
    db.saveProject({ ...project, path: join(root, "moved-away") });
    await expect(reopenProject(context, project.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe("example project", () => {
  it("is removed from the list like any other project", () => {
    db.saveProject({ id: "example", name: "示例项目", path: root, createdAt: "2026-01-01T00:00:00.000Z", openedAt: "2026-01-01T00:00:00.000Z" });
    forgetProject(context, "example");
    expect(db.project("example")).toBeUndefined();
  });
});
