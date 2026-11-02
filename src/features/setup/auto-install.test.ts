import { describe, expect, it } from "vitest";

import { shouldAutoInstall } from "./auto-install";
import type { SetupStatus, ToolStatus } from "./types";

const tool = (id: ToolStatus["id"], state: ToolStatus["state"], required = true, install = true): ToolStatus =>
  ({ id, label: id, state, required, ...(install ? { install: { label: "x", version: "1" } } : {}) });
const status = (tools: ToolStatus[]): SetupStatus =>
  ({ tools, ready: tools.filter((t) => t.required).every((t) => t.state === "ok"), platform: "linux-x64", dataDirectory: "/d", condaEnvironments: [], desktop: false });

describe("shouldAutoInstall", () => {
  it("starts when a required, installable tool is missing", () => {
    expect(shouldAutoInstall(status([tool("java", "missing"), tool("nextflow", "missing")]))).toBe(true);
    expect(shouldAutoInstall(status([tool("java", "ok"), tool("nextflow", "missing")]))).toBe(true);
  });
  it("leaves optional tools, ready machines, running installs and failures alone", () => {
    expect(shouldAutoInstall(status([tool("java", "ok"), tool("nextflow", "ok"), tool("conda", "missing", false)]))).toBe(false);
    expect(shouldAutoInstall(status([tool("java", "installing"), tool("nextflow", "missing")]))).toBe(false);
    expect(shouldAutoInstall(status([tool("java", "error"), tool("nextflow", "missing")]))).toBe(false);
    expect(shouldAutoInstall(status([tool("java", "missing", true, false)]))).toBe(false);
  });
});
