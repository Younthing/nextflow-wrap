import { checkSession, parseAllowedHosts, SESSION_COOKIE, SESSION_HEADER, TOKEN_QUERY, type GuardVerdict } from "./session-guard";

function cookieValue(header: string | null, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return undefined;
}

/**
 * The session check for one request, configured from this server's environment. `src/proxy.ts` runs it for every
 * route; routes the proxy skips (the streaming upload, whose body the proxy would buffer) call it themselves.
 */
export function guardRequest(request: Request, env: NodeJS.ProcessEnv = process.env): GuardVerdict {
  return checkSession({
    token: env.NEXTFLOW_STUDIO_SESSION_TOKEN,
    // The desktop app pins its own random port; a standalone server may sit behind a tunnel on another port.
    port: env.NEXTFLOW_STUDIO_DESKTOP === "1" ? env.PORT : undefined,
    allowedHosts: parseAllowedHosts(env.NEXTFLOW_STUDIO_ALLOWED_HOSTS),
    host: request.headers.get("host"),
    cookie: cookieValue(request.headers.get("cookie"), SESSION_COOKIE),
    header: request.headers.get(SESSION_HEADER),
    query: new URL(request.url).searchParams.get(TOKEN_QUERY),
  });
}
