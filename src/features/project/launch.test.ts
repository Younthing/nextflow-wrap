import { describe, expect, it } from "vitest";

import {
  defaultLaunchConfig,
  launchCommand,
  launchProblems,
  launchTools,
  profileList,
  realLaunchConfig,
  renderRunConfig,
  runtimeProfiles,
} from "./launch";

describe("shell launch", () => {
  it("omits -profile and disables container engines", () => {
    const config = { ...defaultLaunchConfig(), engine: "shell" as const, workDir: "/tmp/nf-work" };
    expect(profileList(config)).toBe("");
    expect(launchCommand(config)).toBe("nextflow run . \\\n    -c run.config \\\n    -params-file params.json");
    const runConfig = renderRunConfig(config);
    expect(runConfig).toContain("process.executor = 'local'");
    expect(runConfig).toContain("docker.enabled = false");
    expect(runConfig).toContain("conda.enabled = false");
    expect(runConfig).not.toContain("-profile");
  });

  it("keeps an extra profile without naming shell", () => {
    const config = { ...defaultLaunchConfig(), engine: "shell" as const, extraProfiles: ["gpu", "debug"] };
    expect(profileList(config)).toBe("gpu,debug");
    expect(launchCommand(config)).toContain("-profile gpu,debug");
    expect(launchCommand(config)).not.toContain("shell");
  });

  it("defaults to the shell and passes a chosen runtime as -profile", () => {
    expect(launchCommand(defaultLaunchConfig())).not.toContain("-profile");
    expect(launchCommand({ ...defaultLaunchConfig(), engine: "conda" })).toContain("-profile conda");
    expect(launchCommand({ ...defaultLaunchConfig(), engine: "docker", extraProfiles: ["gpu"] })).toContain("-profile docker,gpu");
  });

  it("keeps the chosen executor and runtime on a real launch", () => {
    expect(realLaunchConfig({ ...defaultLaunchConfig(), engine: "conda" })).toMatchObject({
      executor: "local",
      engine: "conda",
      settings: { cpus: 2, memory: "2.GB" },
    });
    expect(realLaunchConfig({ ...defaultLaunchConfig(), engine: "apptainer", executor: "hq", resume: true })).toEqual(
      expect.objectContaining({ executor: "hq", engine: "apptainer", settings: {}, resume: false }),
    );
  });
});

describe("cluster executors", () => {
  it("writes HyperQueue and SLURM settings to run.config", () => {
    const hq = renderRunConfig({ ...defaultLaunchConfig(), executor: "hq", workDir: "/shared/work", settings: { queueSize: 500 } });
    expect(hq).toContain("process.executor = 'hq'");
    expect(hq).toContain("executor.queueSize = 500");
    expect(hq).not.toContain("process.queue");
    const slurm = renderRunConfig({ ...defaultLaunchConfig(), executor: "slurm", settings: { queue: "short", clusterOptions: "--account=lab" } });
    expect(slurm).toContain("process.queue = 'short'");
    expect(slurm).toContain("process.clusterOptions = '--account=lab'");
    expect(launchProblems({ ...defaultLaunchConfig(), executor: "slurm", engine: "conda" })).toEqual([]);
  });

  it("names the commands each launch needs", () => {
    expect(launchTools(defaultLaunchConfig())).toEqual([]);
    expect(launchTools({ ...defaultLaunchConfig(), engine: "conda" })).toEqual([["conda"]]);
    expect(launchTools({ ...defaultLaunchConfig(), executor: "hq", engine: "conda" })).toEqual([["hq"]]);
    expect(launchTools({ ...defaultLaunchConfig(), executor: "aws-batch", engine: "docker" })).toEqual([]);
  });
});

describe("runtime profiles", () => {
  it("switches exactly one runtime on per profile", () => {
    const profiles = runtimeProfiles();
    expect(profiles).toContain("    micromamba {\n        conda.enabled = true");
    expect(profiles).toContain("conda.useMicromamba = true");
    const apptainer = profiles.slice(profiles.indexOf("    apptainer {"), profiles.indexOf("    charliecloud {"));
    expect(apptainer).toContain("apptainer.enabled = true");
    expect(apptainer).toContain("docker.enabled = false");
    expect(apptainer).toContain("conda.enabled = false");
  });
});
