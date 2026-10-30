export interface HealthStatus {
  status: "ok" | "degraded";
  nextflowVersion: string;
  mocked: boolean;
  runnerReady?: boolean;
  diagnostics?: string;
  resources?: { architecture: string; cpus: number; memoryBytes: number };
}
