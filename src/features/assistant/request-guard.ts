/** Loopback names this single-user app accepts. Ports are not part of the allowlist. */
export const DEFAULT_COPILOT_HOSTS = ["localhost", "127.0.0.1", "::1"];

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

interface RequestTarget {
  origin: string;
  hostname: string;
}

/**
 * Hostnames allowed to call the assistant. `COPILOT_ALLOWED_HOSTS` is a comma-separated
 * list used when the app is opened through another loopback name. An empty value keeps
 * the defaults. This is not an authentication mechanism.
 */
export function allowedCopilotHosts(env: Record<string, string | undefined> = process.env): string[] {
  const raw = env.COPILOT_ALLOWED_HOSTS;
  if (!raw?.trim()) return [...DEFAULT_COPILOT_HOSTS];
  const hosts = raw.split(",").map((item) => normalizeHostname(item)).filter(Boolean);
  return hosts.length > 0 ? hosts : [...DEFAULT_COPILOT_HOSTS];
}

/** 403 when the request is not from an allowlisted host or is not same-origin. */
export function copilotAccessResponse(
  request: Request,
  options?: { allowedHosts?: readonly string[] },
): Response | null {
  const message = copilotAccessDenial(request, options);
  if (!message) return null;
  return Response.json({ message }, { status: 403, headers: { "cache-control": "no-store" } });
}

export function copilotAccessDenial(
  request: Request,
  options?: { allowedHosts?: readonly string[] },
): string | null {
  const target = requestTarget(request);
  if (!target) return "不允许跨站调用 AI 助手";

  const allowed = new Set((options?.allowedHosts ?? allowedCopilotHosts()).map(normalizeHostname));
  if (!allowed.has(target.hostname)) return "AI 助手只接受本机回环地址";

  const site = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (site && site !== "same-origin" && site !== "same-site" && site !== "none") {
    return "不允许跨站调用 AI 助手";
  }

  const origin = request.headers.get("origin");
  const unsafe = UNSAFE_METHODS.has(request.method.toUpperCase());
  if (unsafe && !origin) return "不允许跨站调用 AI 助手";
  if (origin && !sameOrigin(origin, target.origin)) return "不允许跨站调用 AI 助手";
  return null;
}

function requestTarget(request: Request): RequestTarget | null {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  // Next may rewrite request.url to localhost. The Host header is the browser's target.
  const host = request.headers.get("host")?.trim() || url.host;
  if (!host || /[\s/@\\]/.test(host)) return null;

  let parsed: URL;
  try {
    parsed = new URL(`${url.protocol}//${host}`);
  } catch {
    return null;
  }
  if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
  if (parsed.origin === "null") return null;
  return { origin: parsed.origin, hostname: normalizeHostname(parsed.hostname) };
}

function sameOrigin(originHeader: string, expected: string): boolean {
  if (originHeader.trim().toLowerCase() === "null") return false;
  try {
    return new URL(originHeader).origin === expected;
  } catch {
    return false;
  }
}

function normalizeHostname(hostname: string): string {
  const trimmed = hostname.trim().toLowerCase();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) return trimmed.slice(1, -1);
  return trimmed;
}
