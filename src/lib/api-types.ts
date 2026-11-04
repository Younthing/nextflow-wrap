/** Bumped when the browser/desktop shell and the server stop understanding each other's API. */
export const API_VERSION = 1;

export interface HealthStatus {
  status: "ok" | "degraded";
  /** Server build, so a desktop shell can offer to install a matching one. Absent in the browser demo. */
  appVersion?: string;
  /** Id of this server build (`BUILD` in the package, `app-server.build` in the desktop app). */
  build?: string;
  apiVersion?: number;
  /** Release Studio runs (the launcher fetches the pinned `NXF_VER`). */
  nextflowVersion: string;
  /** What `nextflow -version` prints in a plain shell, when that launcher is a different release. */
  nextflowLauncherVersion?: string;
  mocked: boolean;
  runnerReady?: boolean;
  diagnostics?: string;
  resources?: { architecture: string; cpus: number; memoryBytes: number };
}
