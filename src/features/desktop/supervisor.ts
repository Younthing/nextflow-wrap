/**
 * Restart policy for the processes the desktop app hosts (web server, runner). A crash restarts the process
 * after a growing delay; too many crashes in a short window stop the retries so a broken install does not spin.
 */
export interface RestartPolicy {
  baseDelayMs: number;
  maxDelayMs: number;
  /** Crashes allowed inside `windowMs` before giving up. */
  maxCrashes: number;
  windowMs: number;
}

export const DEFAULT_RESTART: RestartPolicy = { baseDelayMs: 500, maxDelayMs: 15_000, maxCrashes: 5, windowMs: 60_000 };

export class RestartTracker {
  private crashes: number[] = [];
  constructor(private readonly policy: RestartPolicy = DEFAULT_RESTART) {}
  /** Records a crash at `now`; returns the delay before the next start, or undefined to give up. */
  crash(now: number): number | undefined {
    this.crashes = [...this.crashes.filter((time) => now - time < this.policy.windowMs), now];
    if (this.crashes.length > this.policy.maxCrashes) return undefined;
    return Math.min(this.policy.maxDelayMs, this.policy.baseDelayMs * 2 ** (this.crashes.length - 1));
  }
  /** A process that stayed up for a full window counts as healthy again. */
  healthy() { this.crashes = []; }
}

/** What closing the app does. Runs are detached Nextflow heads, so they can outlive the app. */
export type QuitChoice = "background" | "stop" | "cancel";

export function quitPrompt(activeRuns: number): { needed: boolean; message: string; detail: string; buttons: { label: string; choice: QuitChoice }[] } {
  return {
    needed: activeRuns > 0,
    message: `还有 ${activeRuns} 个运行没有结束`,
    detail: "后台继续：Nextflow 继续运行，下次打开应用时接着显示进度和结果。停止：取消这些运行再退出。",
    buttons: [
      { label: "后台继续", choice: "background" },
      { label: "停止运行并退出", choice: "stop" },
      { label: "取消", choice: "cancel" },
    ],
  };
}

/**
 * GUI apps on macOS start with a minimal PATH, so conda, Homebrew and module tools are missing.
 * The desktop asks the user's login shell for its environment; this parses `env -0` output.
 */
export function parseEnvBlock(output: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const entry of output.split("\0")) {
    const index = entry.indexOf("=");
    if (index > 0) env[entry.slice(0, index)] = entry.slice(index + 1);
  }
  return env;
}

/** Keys taken from the login shell; the rest of the app's environment stays as Electron started it. */
export const SHELL_ENV_KEYS = ["PATH", "JAVA_HOME", "CONDA_EXE", "MAMBA_EXE", "MAMBA_ROOT_PREFIX", "NXF_HOME", "NXF_PLUGINS_DIR", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy", "LANG", "LC_ALL"] as const;
