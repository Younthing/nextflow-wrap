/** What the first-run wizard and the settings page show for one tool. */
export type ToolId = "java" | "nextflow" | "weblog" | "conda" | "jupyter" | "docker";
export type ToolState = "ok" | "missing" | "installing" | "error";

export interface ToolStatus {
  id: ToolId;
  label: string;
  state: ToolState;
  /** Required tools block real runs; optional ones only limit some profiles or features. */
  required: boolean;
  version?: string;
  path?: string;
  /** `system`: found on this machine; `managed`: installed by the app under the data directory. */
  source?: "system" | "managed";
  detail?: string;
  /** What one click installs, when the app can install it. */
  install?: { label: string; version: string };
  /** Last lines of the install log while installing or after a failure. */
  log?: string[];
}

export interface CondaEnvironment { name: string; prefix: string; hasKernel: boolean }

export interface SetupStatus {
  tools: ToolStatus[];
  /** True when every required tool is ready, so real runs can start. */
  ready: boolean;
  platform: string;
  dataDirectory: string;
  /** Conda environments found on this machine, offered to the notebook as kernels. */
  condaEnvironments: CondaEnvironment[];
  /** Database and layout upgrades done when this server opened the data directory. */
  migration?: { from: number; to: number; backup?: string };
  desktop: boolean;
}
