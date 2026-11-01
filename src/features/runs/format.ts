import type { RunProgress, RunStatus, TaskStatus } from "./types";

export const RUN_STATUS: Record<RunStatus, { label: string; variant: "default" | "secondary" | "success" | "warning" | "destructive" }> = {
  submitted: { label: "排队中", variant: "secondary" },
  running: { label: "运行中", variant: "default" },
  succeeded: { label: "成功", variant: "success" },
  failed: { label: "失败", variant: "destructive" },
  cancelled: { label: "已停止", variant: "warning" },
  interrupted: { label: "已中断", variant: "warning" },
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

export function currentTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function zonedParts(iso: string, timeZone: string): Intl.DateTimeFormatPart[] | undefined {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
}

/** Local date and time. Pass `timeZone` in tests; the default is the runtime zone. */
export function formatTime(iso?: string, timeZone = currentTimeZone()): string {
  if (!iso) return "—";
  const parts = zonedParts(iso, timeZone);
  if (!parts) return "—";
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const pad = (value: string) => value.padStart(2, "0");
  return `${pick("year")}/${pad(pick("month"))}/${pad(pick("day"))} ${pad(pick("hour"))}:${pad(pick("minute"))}:${pad(pick("second"))}`;
}

/** Short offset such as GMT+8, for the clock the run page is showing. */
export function localTimeZoneLabel(timeZone = currentTimeZone(), date = new Date()): string {
  const value = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
    hour: "2-digit",
  }).formatToParts(date).find((part) => part.type === "timeZoneName")?.value;
  return value ?? timeZone;
}

/** `任务 4/13 完成`, or a discovery line before any task exists. */
export function taskProgressLabel(progress: RunProgress): string {
  if (progress.total <= 0) return "正在发现任务";
  const done = progress.completed + progress.cached;
  return `任务 ${done}/${progress.total} 完成`;
}
