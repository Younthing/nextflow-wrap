import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultSettings } from "@/features/settings/types";
import { applySettingsToEnv, readSecrets, readSettings, saveSettings, settingsUpdateSchema } from "./settings";

const dirs: string[] = [];
const temp = () => { const dir = mkdtempSync(join(tmpdir(), "studio-settings-")); dirs.push(dir); return dir; };
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  delete (globalThis as { studioSettingsApplied?: unknown }).studioSettingsApplied;
});

describe("settings", () => {
  it("falls back to defaults and round-trips a saved file with mode 0600", () => {
    const dir = temp();
    expect(readSettings(dir)).toEqual(defaultSettings());
    const settings = { ...defaultSettings(), runtime: { defaultEngine: "conda" as const, cpus: 8, memory: "16.GB" } };
    saveSettings({ settings }, dir, {});
    expect(readSettings(dir).runtime).toMatchObject({ defaultEngine: "conda", cpus: 8 });
    expect(statSync(join(dir, "settings.json")).mode & 0o777).toBe(0o600);
  });

  it("encrypts API keys when the desktop passes a keychain key, and keeps them out of the view", () => {
    const dir = temp();
    const env = { NEXTFLOW_STUDIO_SECRET_KEY: "a".repeat(64) };
    const view = saveSettings({ settings: defaultSettings(), secrets: { ANTHROPIC_API_KEY: "sk-ant-secret-1234" } }, dir, env);
    expect(view.secrets.ANTHROPIC_API_KEY).toBe(true);
    expect(view.secretStorage).toBe("keychain");
    expect(JSON.stringify(view)).not.toContain("sk-ant-secret");
    expect(readFileSync(join(dir, "secrets.json"), "utf8")).not.toContain("sk-ant-secret");
    expect(readSecrets(dir, env).ANTHROPIC_API_KEY).toBe("sk-ant-secret-1234");
    expect(readSecrets(dir, { NEXTFLOW_STUDIO_SECRET_KEY: "b".repeat(64) }).ANTHROPIC_API_KEY).toBeUndefined();
    saveSettings({ settings: defaultSettings(), secrets: { ANTHROPIC_API_KEY: null } }, dir, env);
    expect(readSecrets(dir, env)).toEqual({});
  });

  it("applies settings to the environment without overriding what the user set", () => {
    const env: Record<string, string | undefined> = { NEXTFLOW_BIN: "/usr/local/bin/nextflow" };
    const settings = { ...defaultSettings(), runtime: { defaultEngine: "shell" as const, nextflowBin: "/opt/nf", javaHome: "/opt/jre" }, assistant: { backend: "builtin" as const } };
    applySettingsToEnv(settings, { OPENAI_API_KEY: "sk-test" }, env);
    expect(env).toMatchObject({ NEXTFLOW_BIN: "/usr/local/bin/nextflow", NEXTFLOW_JAVA_HOME: "/opt/jre", COPILOT_BACKEND: "builtin", OPENAI_API_KEY: "sk-test" });
    applySettingsToEnv(defaultSettings(), {}, env);
    expect(env.NEXTFLOW_JAVA_HOME).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.NEXTFLOW_BIN).toBe("/usr/local/bin/nextflow");
  });

  it("rejects malformed values", () => {
    const bad = { settings: { ...defaultSettings(), runtime: { defaultEngine: "shell", memory: "lots", httpProxy: "socks5://x" } } };
    expect(settingsUpdateSchema.safeParse(bad).success).toBe(false);
  });
});
