import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { executionModuleIndex } from "./execution-index";

describe("executionModuleIndex", () => {
  it("resolves a published script module alongside built-ins", () => {
    const index = executionModuleIndex([
      {
        id: "script/nb_plot/v1",
        path: "plot_v1",
        name: "plot",
        process: "PLOT",
        category: "自定义",
        description: "",
        keywords: [],
        tools: [],
        inputs: [],
        outputs: [],
        origin: "script",
        script: "print(1)\n",
        command: "bin/plot_v1.py",
      },
    ]);
    expect(index.get("script/nb_plot/v1")?.command).toBe("bin/plot_v1.py");
    expect(index.has("builtin/samplesheet")).toBe(true);
  });

  it("is what submit and the runner use when rebuilding a launch", () => {
    const service = readFileSync("src/features/runs/server/service.ts", "utf8");
    const runner = readFileSync("scripts/runner.ts", "utf8");
    expect(service).toContain("executionModuleIndex(store().scriptModules())");
    expect(runner).toContain("executionModuleIndex(db.scriptModules())");
    expect(runner).not.toContain("indexModules((catalog as ModuleCatalog).modules)");
  });
});
