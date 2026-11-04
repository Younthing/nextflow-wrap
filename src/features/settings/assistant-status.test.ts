import { describe, expect, it } from "vitest";
import { cliState } from "./assistant-status";

describe("cliState", () => {
  it("reads the active CLI as logged in", () => {
    expect(cliState({ enabled: true, detail: "本机 Codex", backend: "codex" }, "codex")).toBe("ready");
    expect(cliState({ enabled: true, detail: "本机 Codex", backend: "codex" }, "grok")).toBe("unchecked");
  });

  it("reads why auto skipped a CLI", () => {
    const status = { enabled: true as const, detail: "本机 Grok Build", backend: "grok", codex: "not-installed" as const };
    expect(cliState(status, "codex")).toBe("not-installed");
    expect(cliState(status, "grok")).toBe("ready");
  });

  it("reads a forced CLI that is not ready from the reason", () => {
    expect(cliState({ enabled: false, message: "x", backend: "codex", reason: "codex-unauthenticated" }, "codex")).toBe("unauthenticated");
    expect(cliState({ enabled: false, message: "x", backend: "grok", reason: "grok-not-installed" }, "grok")).toBe("not-installed");
    expect(cliState({ enabled: false, message: "x", reason: "missing-key" }, "codex")).toBe("unchecked");
  });
});
