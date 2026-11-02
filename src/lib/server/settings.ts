import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ENGINES, type ContainerEngine } from "@/features/project/launch";
import { defaultSettings, SECRET_KEYS, type SecretKey, type SettingsUpdate, type SettingsView, type StudioSettings } from "@/features/settings/types";
import { dataDirectory } from "./paths";

type EnvMap = Partial<Record<string, string>>;

const text = (max: number) => z.string().max(max).regex(/^[^\u0000-\u001f]*$/, "不能包含换行或控制字符");
const optionalText = (max: number) => text(max).optional().transform((value) => value?.trim() || undefined);

export const settingsSchema = z.object({
  version: z.literal(1),
  runtime: z.object({
    defaultEngine: z.enum(ENGINES as [ContainerEngine, ...ContainerEngine[]]),
    cpus: z.number().int().min(1).max(1024).optional(),
    memory: optionalText(40).refine((value) => !value || /^\d+(?:\.\d+)?\s*\.?\s*(?:[KMGT]B)$/i.test(value), "写成 16.GB 这样的形式"),
    javaHome: optionalText(1000),
    nextflowBin: optionalText(1000),
    jupyterPython: optionalText(1000),
    httpProxy: optionalText(500).refine((value) => !value || /^https?:\/\//i.test(value), "需要 http:// 或 https:// 开头的代理地址"),
  }),
  notifications: z.object({ runFinished: z.boolean() }),
  assistant: z.object({
    backend: z.enum(["auto", "codex", "builtin"]),
    model: optionalText(200).refine((value) => !value || /^(anthropic|openai|google)\/[\w.:-]+$/.test(value), "写成 provider/model，例如 anthropic/claude-sonnet-5-5"),
    codexModel: optionalText(200),
  }),
});

export const settingsUpdateSchema = z.object({
  settings: settingsSchema,
  secrets: z.record(z.enum(SECRET_KEYS), z.union([text(500).min(8), z.null()])).optional(),
});

const settingsPath = (dir = dataDirectory()) => join(dir, "settings.json");
const secretsPath = (dir = dataDirectory()) => join(dir, "secrets.json");

function writePrivate(path: string, content: string) {
  mkdirSync(join(path, ".."), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, content, { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
}

export function readSettings(dir?: string): StudioSettings {
  try {
    const parsed = settingsSchema.safeParse(JSON.parse(readFileSync(settingsPath(dir), "utf8")));
    return parsed.success ? parsed.data as StudioSettings : defaultSettings();
  } catch { return defaultSettings(); }
}

/**
 * Secrets file. In the desktop app the main process passes `NEXTFLOW_STUDIO_SECRET_KEY`, a random key it keeps
 * encrypted with Electron safeStorage (macOS Keychain / libsecret); values are then AES-256-GCM encrypted at rest.
 * Without that key (web build, Linux without a keyring) the file is plain JSON readable only by the user.
 */
interface SecretFile { encrypted: boolean; values: Partial<Record<SecretKey, string>> }

const secretKey = (env: EnvMap = process.env) => {
  const hex = env.NEXTFLOW_STUDIO_SECRET_KEY;
  return hex && /^[0-9a-f]{64}$/i.test(hex) ? Buffer.from(hex, "hex") : undefined;
};

function seal(value: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((part) => part.toString("base64")).join(".");
}

function open(sealed: string, key: Buffer): string | undefined {
  try {
    const [iv, tag, body] = sealed.split(".").map((part) => Buffer.from(part, "base64"));
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch { return undefined; }
}

export function readSecrets(dir?: string, env: EnvMap = process.env): Partial<Record<SecretKey, string>> {
  let file: SecretFile;
  try { file = JSON.parse(readFileSync(secretsPath(dir), "utf8")) as SecretFile; }
  catch { return {}; }
  const key = secretKey(env);
  const out: Partial<Record<SecretKey, string>> = {};
  for (const name of SECRET_KEYS) {
    const stored = file.values?.[name];
    if (!stored) continue;
    const value = file.encrypted ? (key ? open(stored, key) : undefined) : stored;
    if (value) out[name] = value;
  }
  return out;
}

function writeSecrets(values: Partial<Record<SecretKey, string>>, dir?: string, env: EnvMap = process.env) {
  const key = secretKey(env);
  const file: SecretFile = { encrypted: Boolean(key), values: {} };
  for (const name of SECRET_KEYS) {
    const value = values[name];
    if (value) file.values[name] = key ? seal(value, key) : value;
  }
  writePrivate(secretsPath(dir), `${JSON.stringify(file, null, 2)}\n`);
}

/** Environment variables a settings value maps to. */
export function settingsEnv(settings: StudioSettings, secrets: Partial<Record<SecretKey, string>> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  const set = (key: string, value: string | undefined) => { if (value) env[key] = value; };
  set("NEXTFLOW_JAVA_HOME", settings.runtime.javaHome);
  set("NEXTFLOW_BIN", settings.runtime.nextflowBin);
  set("NEXTFLOW_STUDIO_JUPYTER_PYTHON", settings.runtime.jupyterPython);
  set("NEXTFLOW_HTTP_PROXY", settings.runtime.httpProxy);
  set("COPILOT_BACKEND", settings.assistant.backend === "auto" ? undefined : settings.assistant.backend);
  set("COPILOT_MODEL", settings.assistant.model);
  set("CODEX_MODEL", settings.assistant.codexModel);
  for (const name of SECRET_KEYS) set(name, secrets[name]);
  return env;
}

/**
 * Keys present in the environment before the settings were first applied belong to the user (shell, `.env.local`)
 * and win. Keys this module set are tracked so a later change or removal on the settings page takes effect.
 */
const state = globalThis as typeof globalThis & { studioSettingsApplied?: { userKeys: Set<string>; ours: Set<string> } };

export function applySettingsToEnv(settings: StudioSettings, secrets: Partial<Record<SecretKey, string>>, env: EnvMap = process.env) {
  state.studioSettingsApplied ??= { userKeys: new Set(Object.keys(env).filter((key) => env[key])), ours: new Set() };
  const { userKeys, ours } = state.studioSettingsApplied;
  const next = settingsEnv(settings, secrets);
  for (const key of ours) if (!(key in next)) { delete env[key]; ours.delete(key); }
  for (const [key, value] of Object.entries(next)) {
    if (userKeys.has(key) && !ours.has(key)) continue;
    env[key] = value;
    ours.add(key);
  }
}

export function applyStoredSettings(dir?: string, env: EnvMap = process.env) {
  applySettingsToEnv(readSettings(dir), readSecrets(dir, env), env);
}

export function settingsView(dir?: string, env: EnvMap = process.env): SettingsView {
  const settings = readSettings(dir);
  const secrets = readSecrets(dir, env);
  const userKeys = state.studioSettingsApplied?.userKeys ?? new Set(Object.keys(env));
  const ours = state.studioSettingsApplied?.ours ?? new Set<string>();
  const mapped = Object.keys(settingsEnv({ ...settings, runtime: { ...settings.runtime, javaHome: "x", nextflowBin: "x", jupyterPython: "x", httpProxy: "x" }, assistant: { backend: "codex", model: "x", codexModel: "x" } }, Object.fromEntries(SECRET_KEYS.map((key) => [key, "x"]))));
  return {
    settings,
    secrets: Object.fromEntries(SECRET_KEYS.map((key) => [key, Boolean(secrets[key])])) as Record<SecretKey, boolean>,
    secretStorage: secretKey(env) ? "keychain" : "file",
    environmentOverrides: mapped.filter((key) => userKeys.has(key) && !ours.has(key) && env[key]),
    runnerRestartNeeded: false,
  };
}

export function saveSettings(update: SettingsUpdate, dir?: string, env: EnvMap = process.env): SettingsView {
  const previous = readSettings(dir);
  writePrivate(settingsPath(dir), `${JSON.stringify(update.settings, null, 2)}\n`);
  const secrets = readSecrets(dir, env);
  if (update.secrets) {
    for (const [name, value] of Object.entries(update.secrets) as [SecretKey, string | null][]) {
      if (value === null) delete secrets[name];
      else if (value) secrets[name] = value;
    }
    writeSecrets(secrets, dir, env);
  }
  applySettingsToEnv(update.settings, secrets, env);
  const runtimeChanged = JSON.stringify(previous.runtime) !== JSON.stringify(update.settings.runtime);
  return { ...settingsView(dir, env), runnerRestartNeeded: runtimeChanged };
}
