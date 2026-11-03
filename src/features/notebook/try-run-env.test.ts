import { describe, expect, it } from "vitest";

import {
  clipTryRunLog,
  selectTryRunEngine,
  tryRunEnvLines,
} from "./try-run-env";

describe("try-run environment selection", () => {
  it("uses the host interpreter only when both fields are blank", () => {
    expect(selectTryRunEngine({}, {})).toEqual({ via: "host" });
    expect(tryRunEnvLines({ env: {}, via: "host", language: "python" })).toEqual([
      "未设置 conda / container",
      "选用本机 python3",
    ]);
    expect(tryRunEnvLines({ env: {}, via: "host", language: "r" })[1]).toBe("选用本机 Rscript");
  });

  it("prefers a container runtime and otherwise uses conda", () => {
    const env = { condaYaml: "/envs/py.yml", containerImage: "python:3.11-slim" };
    const container = selectTryRunEngine(env, {
      conda: { bin: "conda", kind: "conda" },
      container: { bin: "docker", kind: "docker" },
    });
    expect(container.via).toBe("container");
    if (container.via !== "container") return;
    expect(container.note).toContain("试跑选用容器");
    expect(tryRunEnvLines({ env, via: "container", language: "python", note: container.note }).join("\n")).toContain(
      "选用 container 'python:3.11-slim'",
    );

    const conda = selectTryRunEngine(env, { conda: { bin: "micromamba", kind: "micromamba" } });
    expect(conda.via).toBe("conda");
    if (conda.via !== "conda") return;
    expect(conda.note).toContain("未找到容器运行时");

    expect(selectTryRunEngine({ containerImage: "img:1" }, {}).via).toBe("unavailable");
    expect(selectTryRunEngine({ condaYaml: "/envs/py.yml" }, {}).via).toBe("unavailable");
    const neither = selectTryRunEngine(env, {});
    expect(neither.via).toBe("unavailable");
    if (neither.via === "unavailable") expect(neither.message).toContain("python:3.11-slim");
  });

  it("quotes the container image in the log", () => {
    expect(tryRunEnvLines({
      env: { containerImage: "ghcr.io/o'brien:1" },
      via: "container",
      language: "python",
    })[0]).toBe("container 'ghcr.io/o\\'brien:1'");
  });

  it("keeps the environment header when the tool output is long", () => {
    const header = "选用 container 'python:3.11-slim'\n$ docker run python:3.11-slim python3 qc.py";
    const log = clipTryRunLog(header, "x".repeat(20_000), 200);
    expect(log.startsWith(header)).toBe(true);
    expect(log.length).toBeLessThanOrEqual(200);
  });
});
