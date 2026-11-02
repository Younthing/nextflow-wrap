/** Bumped when the browser/desktop shell and the server stop understanding each other's API. */
export const API_VERSION = 1;

export interface HealthStatus {
  status: "ok" | "degraded";
  /** Server build, so a desktop shell can offer to install a matching one. Absent in the browser demo. */
  appVersion?: string;
  apiVersion?: number;
  nextflowVersion: string;
  mocked: boolean;
  runnerReady?: boolean;
  diagnostics?: string;
  resources?: { architecture: string; cpus: number; memoryBytes: number };
}
