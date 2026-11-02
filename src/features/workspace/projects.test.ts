import { describe, expect, it } from "vitest";

import {
  displayPath,
  EXAMPLE_PROJECT_ID,
  filterProjects,
  folderName,
  joinProjectPath,
  notebookProjectId,
  openedLabel,
  projectBadge,
  projectIdForPath,
  projectNameError,
  sortRecent,
  touchProject,
} from "./projects";
import type { Project } from "./types";

const project = (id: string, openedAt: string, extra: Partial<Project> = {}): Project => ({
  id,
  name: id,
  path: `/home/demo/${id}`,
  createdAt: "2026-01-01T00:00:00.000Z",
  openedAt,
  ...extra,
});

describe("project ids", () => {
  it("are stable per folder and ignore trailing slashes", () => {
    expect(projectIdForPath("/home/demo/pbmc")).toBe(projectIdForPath("/home/demo/pbmc/"));
    expect(projectIdForPath("/home/demo/pbmc")).not.toBe(projectIdForPath("/home/demo/pbmc2"));
    expect(projectIdForPath("/home/demo/pbmc")).toMatch(/^p_[0-9a-f]{12}$/);
  });

  it("name opened folders after their last segment", () => {
    expect(folderName("/data/lab/visium-pilot/")).toBe("visium-pilot");
    expect(folderName("C:\\Users\\me\\atlas")).toBe("atlas");
  });
});

describe("project names", () => {
  it("accept plain and Chinese names", () => {
    expect(projectNameError("PBMC 单细胞图谱")).toBeUndefined();
    expect(projectNameError("egfr-docking")).toBeUndefined();
  });

  it("reject names that are not a single folder", () => {
    expect(projectNameError(" ")).toBe("请填写项目名称");
    expect(projectNameError("a/b")).toMatch(/不能包含/);
    expect(projectNameError("..")).toMatch(/不能是/);
    expect(projectNameError(".hidden")).toMatch(/不能以/);
    expect(projectNameError("x".repeat(81))).toMatch(/80/);
  });

  it("join onto the parent folder", () => {
    expect(joinProjectPath("/home/demo/Projects/", " atlas ")).toBe("/home/demo/Projects/atlas");
    expect(joinProjectPath("/", "atlas")).toBe("/atlas");
  });
});

describe("recent projects", () => {
  it("sort by last opened", () => {
    const list = sortRecent([project("a", "2026-01-01"), project("b", "2026-03-01"), project("c", "2026-02-01")]);
    expect(list.map((item) => item.id)).toEqual(["b", "c", "a"]);
  });

  it("move a reopened project to the top and keep its name", () => {
    const list = [project("a", "2026-03-01", { name: "Renamed" }), project("b", "2026-02-01")];
    const next = touchProject(list, project("a", "2026-01-01", { name: "a" }), "2026-04-01");
    expect(next[0]).toMatchObject({ id: "a", name: "Renamed", openedAt: "2026-04-01" });
    expect(next).toHaveLength(2);
  });

  it("filter by name or path", () => {
    const list = [project("atlas", "1", { path: "/data/x" }), project("dock", "1", { path: "/home/demo/egfr" })];
    expect(filterProjects(list, "EGFR").map((item) => item.id)).toEqual(["dock"]);
    expect(filterProjects(list, " ")).toHaveLength(2);
  });
});

describe("helpers", () => {
  it("put notebooks without a project into the example project", () => {
    expect(notebookProjectId({})).toBe(EXAMPLE_PROJECT_ID);
    expect(notebookProjectId({ projectId: "p_1" })).toBe("p_1");
  });

  it("shorten the home folder", () => {
    expect(displayPath("/home/demo/Projects/a", "/home/demo")).toBe("~/Projects/a");
    expect(displayPath("/home/demo", "/home/demo/")).toBe("~");
    expect(displayPath("/data/a", "/home/demo")).toBe("/data/a");
  });

  it("give a stable badge", () => {
    expect(projectBadge("单细胞")).toEqual(projectBadge("单细胞"));
    expect(projectBadge("egfr").initial).toBe("E");
  });

  it("label when a project was opened", () => {
    const now = new Date(2026, 10, 2, 12, 0);
    expect(openedLabel(new Date(2026, 10, 2, 11, 50).toISOString(), now)).toBe("10 分钟前");
    expect(openedLabel(new Date(2026, 10, 2, 9, 0).toISOString(), now)).toBe("3 小时前");
    expect(openedLabel(new Date(2026, 10, 1, 9, 0).toISOString(), now)).toBe("昨天");
    expect(openedLabel(new Date(2026, 9, 21, 9, 0).toISOString(), now)).toBe("10 月 21 日");
    expect(openedLabel(new Date(2025, 8, 30, 9, 0).toISOString(), now)).toBe("2025 年 9 月 30 日");
  });
});
