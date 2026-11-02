/**
 * The server can be reached by other pages in the user's browser, and `/api/runs` starts commands, so every
 * request must carry the session token (cookie or header) and a Host the server expects (which defeats DNS
 * rebinding). The desktop app sets the cookie itself; a standalone server (`nextflow-studio serve`) prints a
 * `?token=` link that sets it once.
 *
 * Without `NEXTFLOW_STUDIO_SESSION_TOKEN` (plain `pnpm dev` / `pnpm start`) nothing is checked here.
 */
export const SESSION_COOKIE = "nfs_session";
export const SESSION_HEADER = "x-studio-session";
export const TOKEN_QUERY = "token";

export interface GuardInput {
  token: string | undefined;
  host: string | null;
  cookie: string | undefined;
  header: string | null;
  /** `?token=` of the request, accepted once to set the cookie. */
  query?: string | null;
  /** Only this port is accepted on loopback (the desktop app). Unset for a server reached through a tunnel. */
  port?: string;
  /** Extra host names, from `NEXTFLOW_STUDIO_ALLOWED_HOSTS`, for a server bound to a non-loopback address. */
  allowedHosts?: string[];
}

/** Compare without leaking the matching prefix length through timing. */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index++) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

export function allowedHost(host: string | null, port?: string, extra: string[] = []): boolean {
  if (!host) return false;
  const match = /^(127\.0\.0\.1|localhost|\[::1\])(?::(\d+))?$/i.exec(host);
  if (match) return !port || match[2] === port;
  const lower = host.toLowerCase();
  const name = lower.replace(/:\d+$/, "");
  return extra.some((allowed) => allowed === lower || allowed === name);
}

/** `NEXTFLOW_STUDIO_ALLOWED_HOSTS`: comma separated host names, each optionally with `:port`. */
export function parseAllowedHosts(value: string | undefined): string[] {
  return (value ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
}

export type GuardVerdict =
  | { ok: true; bootstrap?: false }
  /** The `?token=` link matched: set the cookie and redirect to the same URL without the token. */
  | { ok: true; bootstrap: true }
  | { ok: false; status: 403 | 421; reason: string };

export function checkSession(input: GuardInput): GuardVerdict {
  if (!input.token) return { ok: true };
  if (!allowedHost(input.host, input.port, input.allowedHosts)) return { ok: false, status: 421, reason: "Host 不在允许列表中" };
  if (input.query && sameSecret(input.query, input.token)) return { ok: true, bootstrap: true };
  const presented = input.cookie ?? input.header ?? "";
  if (!presented || !sameSecret(presented, input.token)) return { ok: false, status: 403, reason: "缺少会话令牌" };
  return { ok: true };
}
