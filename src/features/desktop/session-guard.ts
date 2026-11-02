/**
 * The desktop app serves the web UI on 127.0.0.1 at a random port. Any web page in the user's browser can reach
 * that port, and `/api/runs` starts commands, so every request must carry the session token Electron set as a
 * cookie, and its Host must be the loopback address (which defeats DNS rebinding).
 *
 * Without `NEXTFLOW_STUDIO_SESSION_TOKEN` (plain `pnpm dev` / `pnpm start`) nothing is checked here.
 */
export const SESSION_COOKIE = "nfs_session";
export const SESSION_HEADER = "x-studio-session";

export interface GuardInput {
  token: string | undefined;
  host: string | null;
  cookie: string | undefined;
  header: string | null;
  port?: string;
}

/** Compare without leaking the matching prefix length through timing. */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index++) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

export function allowedHost(host: string | null, port?: string): boolean {
  if (!host) return false;
  const match = /^(127\.0\.0\.1|localhost|\[::1\])(?::(\d+))?$/i.exec(host);
  if (!match) return false;
  return !port || match[2] === port;
}

export function checkSession(input: GuardInput): { ok: true } | { ok: false; status: 403 | 421; reason: string } {
  if (!input.token) return { ok: true };
  if (!allowedHost(input.host, input.port)) return { ok: false, status: 421, reason: "Host 不是本机回环地址" };
  const presented = input.cookie ?? input.header ?? "";
  if (!presented || !sameSecret(presented, input.token)) return { ok: false, status: 403, reason: "缺少桌面会话令牌" };
  return { ok: true };
}
