import { defaultLaunchConfig, type LaunchConfig } from "@/features/project/launch";

/** Same key the run dialog uses, so the assistant starts with those settings. */
const launchKey = (docId: string) => `nf-studio-launch:${docId || "new"}`;

export interface LaunchStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const DEFAULTS_KEY = "nf-studio-launch-defaults";

/** Defaults from the settings page, used by workflows that have no run settings of their own yet. */
export interface LaunchDefaults { engine: LaunchConfig["engine"]; cpus?: number; memory?: string }

export function rememberLaunchDefaults(defaults: LaunchDefaults, storage?: LaunchStorage) {
  try { (storage ?? localStorage).setItem(DEFAULTS_KEY, JSON.stringify(defaults)); }
  catch { /* Non-essential. */ }
}

function defaultsFrom(store: LaunchStorage): LaunchConfig {
  const base = defaultLaunchConfig();
  try {
    const raw = store.getItem(DEFAULTS_KEY);
    if (!raw) return base;
    const defaults = JSON.parse(raw) as Partial<LaunchDefaults>;
    const settings = { ...base.settings };
    if (defaults.cpus) settings.cpus = defaults.cpus;
    if (defaults.memory) settings.memory = defaults.memory;
    return { ...base, engine: defaults.engine ?? base.engine, settings };
  } catch { return base; }
}

export function readLaunchConfig(docId: string, storage?: LaunchStorage): LaunchConfig {
  try {
    // Resolve localStorage inside the try. A default parameter runs first, so a
    // SecurityError from reading the property would escape this catch.
    const store = storage ?? localStorage;
    const raw = store.getItem(launchKey(docId));
    if (!raw) return defaultsFrom(store);
    return { ...defaultLaunchConfig(), ...(JSON.parse(raw) as Partial<LaunchConfig>), runName: undefined };
  } catch {
    return defaultLaunchConfig();
  }
}

export function rememberLaunchConfig(docId: string, config: LaunchConfig, storage?: LaunchStorage) {
  try {
    const store = storage ?? localStorage;
    store.setItem(launchKey(docId), JSON.stringify({ ...config, runName: undefined }));
  } catch {
    // Non-essential. A blocked localStorage must not crash the run dialog.
  }
}
