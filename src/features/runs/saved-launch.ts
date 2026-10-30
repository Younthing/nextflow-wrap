import { defaultLaunchConfig, type LaunchConfig } from "@/features/project/launch";

/** Same key the run dialog uses, so the assistant starts with those settings. */
const launchKey = (docId: string) => `nf-studio-launch:${docId || "new"}`;

export interface LaunchStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readLaunchConfig(docId: string, storage?: LaunchStorage): LaunchConfig {
  try {
    // Resolve localStorage inside the try. A default parameter runs first, so a
    // SecurityError from reading the property would escape this catch.
    const store = storage ?? localStorage;
    const raw = store.getItem(launchKey(docId));
    if (!raw) return defaultLaunchConfig();
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
