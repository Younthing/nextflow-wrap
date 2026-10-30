import { describe, expect, it } from "vitest";

import { createAssistantResolver, DEFAULT_COPILOT_MODEL, selectAssistantBackend } from "./backend";

const KEY = { ANTHROPIC_API_KEY: "sk-test" };
const authed = { installed: true, authed: true, models: ["gpt-test"] };

describe("selectAssistantBackend", () => {
  it("uses Codex when it is installed and authenticated, without an API key", () => {
    expect(selectAssistantBackend({
      mode: "auto",
      probe: authed,
      model: DEFAULT_COPILOT_MODEL,
      env: { CODEX_MODEL: "gpt-test" },
    })).toEqual({ enabled: true, backend: "codex", model: "gpt-test" });
  });

  it("falls back to the API-key agent when Codex is missing", () => {
    expect(selectAssistantBackend({
      mode: "auto",
      probe: { installed: false },
      model: DEFAULT_COPILOT_MODEL,
      env: KEY,
    })).toEqual({
      enabled: true,
      backend: "builtin",
      model: DEFAULT_COPILOT_MODEL,
      codex: "not-installed",
    });
  });

  it("falls back when Codex is installed but not logged in", () => {
    expect(selectAssistantBackend({
      mode: "auto",
      probe: { installed: true, authed: false },
      model: "openai/gpt-test",
      env: { OPENAI_API_KEY: "sk-openai" },
    })).toEqual({
      enabled: true,
      backend: "builtin",
      model: "openai/gpt-test",
      codex: "unauthenticated",
    });
  });

  it("stays disabled when neither Codex nor the API key is available", () => {
    expect(selectAssistantBackend({
      mode: "auto",
      probe: { installed: false },
      model: DEFAULT_COPILOT_MODEL,
      env: {},
    })).toMatchObject({
      enabled: false,
      reason: "missing-key",
      missing: "ANTHROPIC_API_KEY",
      message: "AI 助手未启用：服务端没有设置 ANTHROPIC_API_KEY",
    });
    expect(selectAssistantBackend({
      mode: "auto",
      probe: { installed: true, authed: false },
      model: DEFAULT_COPILOT_MODEL,
      env: {},
    })).toMatchObject({
      enabled: false,
      reason: "codex-unauthenticated",
      message: "AI 助手未启用：Codex 未登录，且服务端没有设置 ANTHROPIC_API_KEY",
    });
  });

  it("does not use an API key when Codex is required", () => {
    expect(selectAssistantBackend({
      mode: "codex",
      probe: { installed: false },
      model: DEFAULT_COPILOT_MODEL,
      env: KEY,
    })).toMatchObject({ enabled: false, backend: "codex", reason: "codex-not-installed" });
    expect(selectAssistantBackend({
      mode: "codex",
      probe: { installed: true, authed: false },
      model: DEFAULT_COPILOT_MODEL,
      env: {},
    })).toMatchObject({ enabled: false, reason: "codex-unauthenticated" });
    expect(selectAssistantBackend({
      mode: "codex",
      probe: { installed: true },
      model: DEFAULT_COPILOT_MODEL,
      env: {},
    })).toMatchObject({ enabled: false, reason: "codex-unavailable" });
  });

  it("skips Codex entirely for the builtin backend", () => {
    expect(selectAssistantBackend({
      mode: "builtin",
      probe: authed,
      model: "google/gemini-test",
      env: { GOOGLE_API_KEY: "key" },
    })).toEqual({ enabled: true, backend: "builtin", model: "google/gemini-test" });
    expect(selectAssistantBackend({
      mode: "builtin",
      model: DEFAULT_COPILOT_MODEL,
      env: {},
    })).toMatchObject({ enabled: false, backend: "builtin", missing: "ANTHROPIC_API_KEY" });
  });

  it("rejects an unknown backend name", () => {
    expect(selectAssistantBackend({
      mode: "invalid",
      probe: authed,
      model: DEFAULT_COPILOT_MODEL,
      env: KEY,
    })).toMatchObject({ enabled: false, reason: "invalid-backend" });
  });
});

describe("createAssistantResolver", () => {
  it("caches a Codex probe and does not probe the builtin backend", async () => {
    let calls = 0;
    let now = 0;
    const env: Record<string, string | undefined> = { COPILOT_BACKEND: "auto", ...KEY };
    const resolve = createAssistantResolver({
      env,
      now: () => now,
      ttlMs: 1_000,
      probe: async () => {
        calls += 1;
        return { installed: false };
      },
    });
    await resolve();
    await resolve();
    expect(calls).toBe(1);
    now = 1_000;
    await resolve();
    expect(calls).toBe(2);

    env.COPILOT_BACKEND = "builtin";
    await resolve();
    expect(calls).toBe(2);
  });
});
