import type { SetupStatus } from "./types";

/** Missing required tools the app can install, with nothing installing or failed: start installing them. */
export function shouldAutoInstall(status: SetupStatus): boolean {
  if (status.ready || status.tools.some((tool) => tool.state === "installing" || tool.state === "error")) return false;
  return status.tools.some((tool) => tool.required && tool.state === "missing" && tool.install);
}
