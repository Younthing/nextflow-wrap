import { describe, expect, it } from "vitest";
import { parseAssistantStatus } from "./queries";

describe("parseAssistantStatus", () => {
  it("keeps the header detail and adds the facts the settings page shows", () => {
    expect(parseAssistantStatus({ enabled: true, backend: "codex", model: "gpt-5" })).toEqual({
      enabled: true,
      detail: "本机 Codex（gpt-5）",
      backend: "codex",
      model: "gpt-5",
    });
    expect(parseAssistantStatus({ enabled: true, backend: "builtin", model: "anthropic/x", codex: "not-installed", grok: "unauthenticated" })).toMatchObject({
      enabled: true,
      detail: "anthropic/x",
      codex: "not-installed",
      grok: "unauthenticated",
    });
  });

  it("passes the reason and missing key through when the assistant is off", () => {
    expect(parseAssistantStatus({ enabled: false, backend: "auto", reason: "missing-key", missing: "ANTHROPIC_API_KEY", message: "AI 助手未启用：服务端没有设置 ANTHROPIC_API_KEY" })).toEqual({
      enabled: false,
      message: "AI 助手未启用：服务端没有设置 ANTHROPIC_API_KEY",
      backend: "auto",
      reason: "missing-key",
      missing: "ANTHROPIC_API_KEY",
    });
    expect(parseAssistantStatus({ enabled: false })).toEqual({ enabled: false, message: "AI 助手未启用" });
  });
});
