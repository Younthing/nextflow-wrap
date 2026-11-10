import { describe, expect, it } from "vitest";

import { resolveDataParams, samplesheetWorkspaceFiles } from "./data-params";

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
    expect(resolveDataParams({ a: "/data/shared.csv", b: "../shared.csv" }, ["a", "b"], { root: "/project", remote: false, exists: () => true })).toEqual({ params: { a: "/data/shared.csv", b: "/project/../shared.csv" }, errors: [], sync: [] });
  });
  it("lists workspace data a cluster run must copy and keeps cluster paths as they are", () => {
    const { params, errors, sync } = resolveDataParams({ a: "/scratch/x.fq", b: "./data/reads.fq" }, ["a", "b"], { root: "/srv/proj", remote: true, exists });
    expect(errors).toEqual([]);
    expect(params).toEqual({ a: "/scratch/x.fq", b: "data/reads.fq" });
    expect(sync).toEqual(["data/reads.fq"]);
  });
  it("refuses workspace data a cluster run cannot copy", () => {
    const { errors, sync } = resolveDataParams({ a: "data/*.fq", b: "../outside.fq", c: "data/missing.fq" }, ["a", "b", "c"], { root: "/srv/proj", remote: true, exists: () => false });
    expect(sync).toEqual([]);
    expect(errors).toEqual([
      "--a 是工作区里的通配路径，集群运行请改成文件夹，或填写集群上的绝对路径",
      "--b 不在项目文件夹里，集群运行无法上传：../outside.fq",
      "工作区里没有 data/missing.fq",
    ]);
  });
  it("needs a project for workspace paths", () => {
    expect(resolveDataParams({ a: "data/x" }, ["a"], { remote: false, exists }).errors).toEqual(["流程不属于任何项目，无法解析工作区路径"]);
  });
});

describe("samplesheetWorkspaceFiles", () => {
  it("finds the workspace files a sheet names, quoted or not, and skips sample names and remote paths", () => {
    const csv = 'sample,fastq_1,fastq_2\nS1,data/S1_R1.fq.gz,"data/S1_R2.fq.gz"\nS2,/scratch/S2.fq.gz,\nS3,data/missing.fq,\n';
    const present = new Set(["data/S1_R1.fq.gz", "data/S1_R2.fq.gz"]);
    expect(samplesheetWorkspaceFiles(csv, (path) => present.has(path))).toEqual(["data/S1_R1.fq.gz", "data/S1_R2.fq.gz"]);
  });
});
