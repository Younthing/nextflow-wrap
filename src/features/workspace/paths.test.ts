import { describe, expect, it } from "vitest";

import { dataPathKind, normalizeWorkspacePath, resolveWorkspacePath, toWorkspacePath } from "./paths";

describe("workspace paths", () => {
  it("tells workspace paths from URIs and absolute paths", () => {
    expect(dataPathKind("data/reads.fq")).toBe("workspace");
    expect(dataPathKind("./data//reads.fq")).toBe("workspace");
    expect(dataPathKind("s3://bucket/reads.fq")).toBe("uri");
    expect(dataPathKind("/scratch/me/reads.fq")).toBe("absolute");
    expect(dataPathKind("C:\\data\\x.csv")).toBe("absolute");
    expect(dataPathKind("../etc/passwd")).toBe("invalid");
    expect(dataPathKind("data/../../x")).toBe("invalid");
    expect(dataPathKind("  ")).toBe("invalid");
  });
  it("stores picks inside the workspace as relative paths", () => {
    expect(toWorkspacePath("/home/me/proj/data/reads.fq", "/home/me/proj")).toBe("data/reads.fq");
    expect(toWorkspacePath("/home/me/proj/data/reads.fq", "/home/me/proj/")).toBe("data/reads.fq");
    expect(toWorkspacePath("/home/me/project-b/x", "/home/me/proj")).toBe("/home/me/project-b/x");
    expect(toWorkspacePath("/x", undefined)).toBe("/x");
  });
  it("resolves inside the workspace only", () => {
    expect(normalizeWorkspacePath("./data//reads.fq")).toBe("data/reads.fq");
    expect(resolveWorkspacePath("data/reads.fq", "/srv/proj")).toBe("/srv/proj/data/reads.fq");
    expect(resolveWorkspacePath("data/../../etc/passwd", "/srv/proj")).toBeUndefined();
    expect(resolveWorkspacePath("/etc/passwd", "/srv/proj")).toBeUndefined();
  });
});
