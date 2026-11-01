import { describe, expect, it } from "vitest";
import { defaultLaunchConfig } from "@/features/project/launch";
import { assertSameOrigin, checkedLaunch } from "./service";

describe("local API origin validation", () => {
  it("accepts the actual browser host when Next.js normalizes its internal URL", () => {
    const request = new Request("http://localhost:3000/api/runs", { method: "POST", headers: { origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000", "sec-fetch-site": "same-origin" } });
    expect(() => assertSameOrigin(request)).not.toThrow();
  });
  it("rejects cross-site forms and forged origins", () => {
    const cases: Record<string, string>[] = [{ origin: "https://external.example", host: "127.0.0.1:3000" }, { "sec-fetch-site": "cross-site", host: "127.0.0.1:3000" }];
    for (const headers of cases) {
      expect(() => assertSameOrigin(new Request("http://localhost:3000/api/runs", { method: "POST", headers }))).toThrow("不允许跨站");
    }
  });
});

describe("launch validation", () => {
  const base = { ...defaultLaunchConfig(), extraProfiles: [] as ("test" | "debug")[], registry: "quay.io" as const };

  it("keeps any Nextflow executor and runtime the form offers", () => {
    expect(checkedLaunch({ ...base, engine: "conda" })).toMatchObject({ executor: "local", engine: "conda" });
    const hq = checkedLaunch({ ...base, executor: "hq", engine: "apptainer", workDir: "/shared/work", settings: { queueSize: "200" } });
    expect(hq).toMatchObject({ executor: "hq", engine: "apptainer", workDir: "/shared/work", settings: { queueSize: 200 } });
  });

  it("refuses settings the executor does not have, bad values and relative cluster work directories", () => {
    expect(() => checkedLaunch({ ...base, settings: { queue: "x" } })).toThrow("没有设置项 queue");
    expect(() => checkedLaunch({ ...base, settings: { cpus: "0" } })).toThrow("正整数");
    expect(() => checkedLaunch({ ...base, settings: { memory: "lots" } })).toThrow("16.GB");
    expect(() => checkedLaunch({ ...base, executor: "slurm", workDir: "scratch" })).toThrow("绝对路径");
    expect(() => checkedLaunch({ ...base, executor: "aws-batch", engine: "conda", settings: { queue: "q", region: "r" }, workDir: "s3://b/w" })).toThrow("不支持");
  });
});
