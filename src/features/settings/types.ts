import type { ContainerEngine } from "@/features/project/launch";
import type { RemoteHost } from "@/features/remote/types";

export type AssistantBackend = "auto" | "codex" | "builtin";
export const ASSISTANT_SECRET_KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY"] as const;
/** Cloud keys Nextflow reads from the environment for AWS Batch / S3 and Azure Batch / Blob. */
export const CLOUD_SECRET_KEYS = ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AZURE_BATCH_ACCOUNT_KEY", "AZURE_STORAGE_ACCOUNT_KEY"] as const;
export const SECRET_KEYS = [...ASSISTANT_SECRET_KEYS, ...CLOUD_SECRET_KEYS] as const;
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
  /** Cluster login nodes runs can go to over SSH. */
  remotes: RemoteHost[];
  /** Non-secret cloud settings; the keys themselves are secrets. */
  cloud: {
    /** `AWS_PROFILE` from ~/.aws/config, instead of or besides access keys. */
    awsProfile?: string;
    awsRegion?: string;
    /** Service account JSON file for Google Batch and GCS (`GOOGLE_APPLICATION_CREDENTIALS`). */
    googleCredentials?: string;
    azureBatchAccount?: string;
    azureStorageAccount?: string;
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
  remotes: [],
  cloud: {},
});
