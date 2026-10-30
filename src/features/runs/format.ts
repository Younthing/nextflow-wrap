import type { RunStatus, TaskStatus } from "./types";

export const RUN_STATUS: Record<RunStatus, { label: string; variant: "default" | "secondary" | "success" | "warning" | "destructive" }> = {
  submitted: { label: "排队中", variant: "secondary" },
  running: { label: "运行中", variant: "default" },
  succeeded: { label: "成功", variant: "success" },
  failed: { label: "失败", variant: "destructive" },
  cancelled: { label: "已停止", variant: "warning" },
};

export const TASK_STATUS: Record<TaskStatus, { label: string; color: string }> = {
  pending: { label: "等待", color: "var(--muted-foreground)" },
  submitted: { label: "已提交", color: "var(--muted-foreground)" },
  running: { label: "运行中", color: "var(--primary)" },
  completed: { label: "完成", color: "var(--success)" },
  cached: { label: "缓存", color: "var(--success)" },
  failed: { label: "失败", color: "var(--destructive)" },
  aborted: { label: "中止", color: "var(--warning)" },
};

export function formatDuration(ms?: number): string {
  if (ms === undefined || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function runDuration(run: { startedAt?: string; completedAt?: string }, now = Date.now()): number | undefined {
  if (!run.startedAt) return undefined;
  return (run.completedAt ? Date.parse(run.completedAt) : now) - Date.parse(run.startedAt);
}

export function formatBytes(bytes?: number): string {
  if (bytes === undefined) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 && i ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function formatTime(iso?: string): string {
  return iso ? new Date(iso).toLocaleString("zh-CN", { hour12: false }) : "—";
}
