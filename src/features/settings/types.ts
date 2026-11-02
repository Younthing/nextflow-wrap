import type { ContainerEngine } from "@/features/project/launch";

export type AssistantBackend = "auto" | "codex" | "builtin";
export const SECRET_KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY"] as const;
export type SecretKey = (typeof SECRET_KEYS)[number];

/** Everything the settings page edits. Stored in `<data>/settings.json`; API keys separately in `secrets.json`. */
export interface StudioSettings {
  version: 1;
  runtime: {
    /** Default `-profile` for new runs of a workflow that has no saved run settings. */
    defaultEngine: ContainerEngine;
    /** Default local CPU and memory limits for new runs. */
    cpus?: number;
    memory?: string;
    javaHome?: string;
    nextflowBin?: string;
    jupyterPython?: string;
    httpProxy?: string;
  };
  notifications: {
    /** System notification when a run finishes or fails. */
    runFinished: boolean;
  };
  assistant: {
    backend: AssistantBackend;
    /** `<provider>/<model>` for the built-in backend. */
    model?: string;
    codexModel?: string;
  };
}

/** What the API returns: secrets never leave the server, only whether each one is set and how it is stored. */
export interface SettingsView {
  settings: StudioSettings;
  secrets: Record<SecretKey, boolean>;
  /** `keychain`: encrypted with a key the OS keychain protects (desktop); `file`: a 0600 file. */
  secretStorage: "keychain" | "file";
  /** Values the process environment already sets; they win over the settings page. */
  environmentOverrides: string[];
  /** The runner reads runtime settings when it starts. */
  runnerRestartNeeded: boolean;
}

export interface SettingsUpdate {
  settings: StudioSettings;
  /** A string sets the key, null removes it, absent leaves it unchanged. */
  secrets?: Partial<Record<SecretKey, string | null>>;
}

export const defaultSettings = (): StudioSettings => ({
  version: 1,
  runtime: { defaultEngine: "shell" },
  notifications: { runFinished: true },
  assistant: { backend: "auto" },
});
