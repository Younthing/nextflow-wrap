import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultSettings } from "@/features/settings/types";
import { writeFileSync } from "node:fs";
import { applySettingsToEnv, readSecrets, readSettings, saveSettings, settingsEnv, settingsUpdateSchema } from "./settings";

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

  it("maps the Grok backend and model to the variables the assistant reads", () => {
    const settings = { ...defaultSettings(), assistant: { backend: "grok" as const, grokModel: "grok-code" } };
    expect(settingsUpdateSchema.safeParse({ settings }).success).toBe(true);
    expect(settingsEnv(settings)).toMatchObject({ COPILOT_BACKEND: "grok", GROK_MODEL: "grok-code" });
  });

  it("rejects malformed values", () => {
    const bad = { settings: { ...defaultSettings(), runtime: { defaultEngine: "shell", memory: "lots", httpProxy: "socks5://x" } } };
    expect(settingsUpdateSchema.safeParse(bad).success).toBe(false);
  });

  it("validates and persists latest or an exact Nextflow version", () => {
    const dir = temp();
    for (const nextflowVersion of ["latest", "26.10.5"]) {
      const update = settingsUpdateSchema.parse({ settings: { ...defaultSettings(), runtime: { defaultEngine: "shell", nextflowVersion } } });
      const env: Record<string, string | undefined> = {};
      expect(saveSettings(update, dir, env).runnerRestartNeeded).toBe(true);
      expect(readSettings(dir).runtime.nextflowVersion).toBe(nextflowVersion);
      expect(settingsEnv(readSettings(dir)).NEXTFLOW_STUDIO_NEXTFLOW_VERSION).toBe(nextflowVersion);
    }
    for (const nextflowVersion of ["v26.10.5", "26", "stable", "26.10.5; id"]) {
      expect(settingsUpdateSchema.safeParse({ settings: { ...defaultSettings(), runtime: { defaultEngine: "shell", nextflowVersion } } }).success).toBe(false);
    }
  });

  it("persists multiline Nextflow setup, normalizes line endings and can clear it", () => {
    const dir = temp();
    const env: Record<string, string | undefined> = {};
    const update = settingsUpdateSchema.parse({ settings: {
      ...defaultSettings(), runtime: { defaultEngine: "shell", nextflowSetup: "source ~/miniconda3/etc/profile.d/conda.sh\r\nconda activate bia-main" },
    } });
    const setup = "source ~/miniconda3/etc/profile.d/conda.sh\nconda activate bia-main";
    expect(saveSettings(update, dir, env).runnerRestartNeeded).toBe(true);
    expect(readSettings(dir).runtime.nextflowSetup).toBe(setup);
    expect(env.NEXTFLOW_STUDIO_NEXTFLOW_SETUP).toBe(setup);
    expect(saveSettings({ settings: defaultSettings() }, dir, env).runnerRestartNeeded).toBe(true);
    expect(env.NEXTFLOW_STUDIO_NEXTFLOW_SETUP).toBeUndefined();
    expect(readSettings(dir).runtime.nextflowSetup).toBeUndefined();
    for (const nextflowSetup of ["echo bad\0", "x".repeat(10_001)]) {
      expect(settingsUpdateSchema.safeParse({ settings: { ...defaultSettings(), runtime: { defaultEngine: "shell", nextflowSetup } } }).success).toBe(false);
    }
  });

  it("reads a settings file from before remote hosts and cloud settings existed", () => {
    const dir = temp();
    const old: Partial<ReturnType<typeof defaultSettings>> = defaultSettings();
    delete old.remotes;
    delete old.cloud;
    writeFileSync(join(dir, "settings.json"), JSON.stringify({ ...old, runtime: { defaultEngine: "conda" } }));
    expect(readSettings(dir)).toMatchObject({ runtime: { defaultEngine: "conda" }, remotes: [], cloud: {} });
  });

  it("checks remote hosts so their fields are safe on an ssh command line", () => {
    const host = { id: "hpc", name: "HPC", host: "login.example.org", user: "ana", baseDir: "~/nf", nextflow: "~/bin/nextflow", setup: "module load nextflow" };
    const parse = (remotes: unknown[]) => settingsUpdateSchema.safeParse({ settings: { ...defaultSettings(), remotes } });
    expect(parse([host]).success).toBe(true);
    for (const bad of [{ host: "-oProxyCommand=x" }, { host: "a b" }, { user: "a;b" }, { baseDir: "relative" }, { baseDir: "/a b" }, { baseDir: "/x/$(id)" }, { nextflow: "nextflow; rm" }, { id: "Bad Id" }, { port: 70000 }]) {
      expect(parse([{ ...host, ...bad }]).success, JSON.stringify(bad)).toBe(false);
    }
    expect(parse([host, { ...host, name: "again" }]).success).toBe(false);
  });

  it("maps cloud settings and keys to the variables Nextflow reads", () => {
    const settings = { ...defaultSettings(), cloud: { awsProfile: "lab", awsRegion: "eu-west-1", googleCredentials: "/keys/sa.json", azureBatchAccount: "labbatch", azureStorageAccount: "labstore" } };
    expect(settingsEnv(settings, { AWS_ACCESS_KEY_ID: "AKIAEXAMPLE", AWS_SECRET_ACCESS_KEY: "secret-123456", AZURE_BATCH_ACCOUNT_KEY: "batch-key-1", AZURE_STORAGE_ACCOUNT_KEY: "store-key-1" })).toMatchObject({
      AWS_PROFILE: "lab", AWS_REGION: "eu-west-1", AWS_DEFAULT_REGION: "eu-west-1", GOOGLE_APPLICATION_CREDENTIALS: "/keys/sa.json",
      AZURE_BATCH_ACCOUNT_NAME: "labbatch", AZURE_STORAGE_ACCOUNT_NAME: "labstore",
      AWS_ACCESS_KEY_ID: "AKIAEXAMPLE", AWS_SECRET_ACCESS_KEY: "secret-123456", AZURE_BATCH_ACCOUNT_KEY: "batch-key-1", AZURE_STORAGE_ACCOUNT_KEY: "store-key-1",
    });
    expect(settingsUpdateSchema.safeParse({ settings: { ...defaultSettings(), cloud: { awsRegion: "Frankfurt" } } }).success).toBe(false);
  });

  it("asks for a runner restart when cloud credentials change, not when only remote hosts do", () => {
    const dir = temp();
    expect(saveSettings({ settings: { ...defaultSettings(), remotes: [{ id: "hpc", name: "HPC", host: "h", baseDir: "~/nf" }] } }, dir, {}).runnerRestartNeeded).toBe(false);
    expect(saveSettings({ settings: readSettings(dir), secrets: { AWS_SECRET_ACCESS_KEY: "secret-123456" } }, dir, {}).runnerRestartNeeded).toBe(true);
    expect(saveSettings({ settings: { ...readSettings(dir), cloud: { awsProfile: "lab" } } }, dir, {}).runnerRestartNeeded).toBe(true);
  });
});
