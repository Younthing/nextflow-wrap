import { defaultLaunchConfig, type LaunchConfig } from "@/features/project/launch";

/** Same key the run dialog uses, so the assistant starts with those settings. */
const launchKey = (docId: string) => `nf-studio-launch:${docId || "new"}`;

export interface LaunchStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readLaunchConfig(docId: string, storage: LaunchStorage = localStorage): LaunchConfig {
  try {
    const raw = storage.getItem(launchKey(docId));
    if (!raw) return defaultLaunchConfig();
    return { ...defaultLaunchConfig(), ...(JSON.parse(raw) as Partial<LaunchConfig>), runName: undefined };
  } catch {
    return defaultLaunchConfig();
  }
}

export function rememberLaunchConfig(docId: string, config: LaunchConfig, storage: LaunchStorage = localStorage) {
  try {
    storage.setItem(launchKey(docId), JSON.stringify({ ...config, runName: undefined }));
  } catch {
    // Non-essential.
  }
}
