import { describe, expect, it } from "vitest";

import { resolveDataParams } from "./data-params";

const exists = (path: string) => path === "/srv/proj/data/reads.fq";

describe("resolveDataParams", () => {
  it("resolves workspace paths for a local run and leaves other params alone", () => {
    const { params, errors } = resolveDataParams({ reads: "data/reads.fq", sheet: "s3://b/x.csv", glob: "data/*.fq", threads: 4 }, ["reads", "sheet", "glob"], { root: "/srv/proj", remote: false, exists });
    expect(errors).toEqual([]);
    expect(params).toEqual({ reads: "/srv/proj/data/reads.fq", sheet: "s3://b/x.csv", glob: "/srv/proj/data/*.fq", threads: 4 });
  });
  it("reports missing project and external inputs", () => {
    const { errors } = resolveDataParams({ a: "/home/me/x.fq", b: "data/missing.fq", c: "../x" }, ["a", "b", "c"], { root: "/srv/proj", remote: false, exists });
    expect(errors).toEqual([
      "找不到外部数据：/home/me/x.fq",
      "工作区里没有 data/missing.fq",
      "工作区里没有 ../x",
    ]);
  });
  it("accepts existing absolute and parent-relative data", () => {
    expect(resolveDataParams({ a: "/data/shared.csv", b: "../shared.csv" }, ["a", "b"], { root: "/project", remote: false, exists: () => true })).toEqual({ params: { a: "/data/shared.csv", b: "/project/../shared.csv" }, errors: [] });
  });
  it("needs cluster paths on a cluster run", () => {
    const { params, errors } = resolveDataParams({ a: "/scratch/x.fq", b: "data/reads.fq" }, ["a", "b"], { remote: true, exists });
    expect(params.a).toBe("/scratch/x.fq");
    expect(errors).toEqual(["--b 是工作区里的文件，集群上没有；集群运行请填集群上的绝对路径"]);
  });
  it("needs a project for workspace paths", () => {
    expect(resolveDataParams({ a: "data/x" }, ["a"], { remote: false, exists }).errors).toEqual(["流程不属于任何项目，无法解析工作区路径"]);
  });
});
