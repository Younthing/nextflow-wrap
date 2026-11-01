import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { runCommand } from "@/features/project/server/command";
import {
  clipTryRunLog,
  condaCreateCommand,
  condaRunCommand,
  containerCommand,
  selectTryRunEngine,
  tryRunEnvLines,
} from "./try-run-env";

const shimPath = fileURLToPath(new URL("../../../scripts/e2e-docker-shim.sh", import.meta.url));

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

  it("builds conda and container argv without a shell", () => {
    expect(condaCreateCommand({ bin: "micromamba", kind: "micromamba" }, "/prefix", "/env.yml").args).toEqual([
      "create", "-y", "-p", "/prefix", "-f", "/env.yml",
    ]);
    expect(condaRunCommand({ bin: "conda", kind: "conda" }, "/prefix", ["python3", "qc.py"]).args).toEqual([
      "run", "-p", "/prefix", "--no-capture-output", "python3", "qc.py",
    ]);
    expect(containerCommand(
      { bin: "docker", kind: "docker" },
      "/work",
      "python:3.11-slim",
      ["python3", "qc.py"],
    ).args).toEqual(["run", "--rm", "-v", "/work:/work", "-w", "/work", "python:3.11-slim", "python3", "qc.py"]);
    expect(containerCommand(
      { bin: "apptainer", kind: "apptainer" },
      "/work",
      "python:3.11",
      ["Rscript", "plot.R"],
    ).args).toEqual(["exec", "--bind", "/work:/work", "--pwd", "/work", "docker://python:3.11", "Rscript", "plot.R"]);
    expect(containerCommand(
      { bin: "singularity", kind: "singularity" },
      "/work",
      "docker://python:3.11",
      ["python3", "qc.py"],
    ).args[5]).toBe("docker://python:3.11");
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

  it("executes the task command the container argv names", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nb-shim-"));
    try {
      await writeFile(join(dir, "task.py"), "open('marker.txt','w').write('ok')\n");
      const launch = containerCommand(
        { bin: shimPath, kind: "docker" },
        dir,
        "python:3.11-slim",
        ["python3", "task.py"],
      );
      const output = await runCommand(launch.executable, launch.args, { cwd: dir, quiet: true, timeoutMs: 20_000 });
      expect(output).toContain("e2e docker shim: image python:3.11-slim");
      expect(await readFile(join(dir, "marker.txt"), "utf8")).toBe("ok");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
