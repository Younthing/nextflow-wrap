import { describe, expect, it } from "vitest";

import { defaultLaunchConfig } from "@/features/project/launch";
import { effectiveLaunchConfig, setupProblems } from "./launch-request";

describe("effectiveLaunchConfig", () => {
  it("falls back to this machine when the saved cluster is gone", () => {
    const saved = { ...defaultLaunchConfig(), remote: "gone", workDir: "/scratch/work" };
    const config = effectiveLaunchConfig(saved, [], false);
    expect(config.remote).toBeUndefined();
    expect(config.workDir).toBe("work");
  });

  it("keeps a cluster that still exists", () => {
    const saved = { ...defaultLaunchConfig(), remote: "hpc" };
    expect(effectiveLaunchConfig(saved, [{ id: "hpc" } as never], false).remote).toBe("hpc");
  });
});

describe("setupProblems", () => {
  const launch = defaultLaunchConfig();
  it("asks to save an unsaved workflow and reports a runner that is not ready", () => {
    expect(
      setupProblems({
        docId: "",
        saveShortcut: "Ctrl+S",
        generated: { error: "坏了" },
        launch,
        health: { status: "degraded", nextflowVersion: "", mocked: false, runnerReady: false, diagnostics: "没有 Java" },
      }),
    ).toEqual(["请先保存流程（Ctrl+S）", "无法生成项目：坏了", ...setupProblems({ docId: "x", saveShortcut: "", generated: null, launch, health: undefined }), "没有 Java"]);
  });

  it("has nothing to say for a saved workflow on the mock backend", () => {
    expect(setupProblems({ docId: "wf", saveShortcut: "", generated: null, launch, health: { status: "ok", nextflowVersion: "", mocked: true } })).toEqual([]);
  });
});
