import { describe, expect, it } from "vitest";

import { defaultLaunchConfig, launchCommand, profileList, realLaunchConfig, renderRunConfig } from "./launch";

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
    const config = { ...defaultLaunchConfig(), engine: "shell" as const, extraProfiles: ["test", "debug"] };
    expect(profileList(config)).toBe("test,debug");
    expect(launchCommand(config)).toContain("-profile test,debug");
    expect(launchCommand(config)).not.toContain("shell");
  });

  it("still passes the docker profile", () => {
    expect(launchCommand(defaultLaunchConfig())).toContain("-profile docker");
  });

  it("keeps shell on a real launch and turns other engines into docker", () => {
    expect(realLaunchConfig({ ...defaultLaunchConfig(), engine: "shell", executor: "slurm" }).engine).toBe("shell");
    expect(realLaunchConfig({ ...defaultLaunchConfig(), engine: "singularity", executor: "slurm" })).toMatchObject({
      executor: "local",
      engine: "docker",
      resume: false,
    });
  });
});
