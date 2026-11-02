import { NextResponse, type NextRequest } from "next/server";

import { guardRequest } from "@/features/desktop/server-guard";
import { SESSION_COOKIE, TOKEN_QUERY } from "@/features/desktop/session-guard";

const COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

/** Only holders of the session token (the desktop window, or a browser that opened the `?token=` link) may use this server. */
export function proxy(request: NextRequest) {
  const verdict = guardRequest(request);
  if (!verdict.ok) return new NextResponse(verdict.reason, { status: verdict.status, headers: { "content-type": "text/plain; charset=utf-8" } });
  if (!verdict.bootstrap) return NextResponse.next();
  // Drop the token from the address bar and history; the cookie carries it from now on.
  const clean = request.nextUrl.clone();
  clean.searchParams.delete(TOKEN_QUERY);
  const host = request.headers.get("host");
  const location = host ? `${clean.protocol}//${host}${clean.pathname}${clean.search}` : clean.toString();
  const response = NextResponse.redirect(location, 302);
  response.cookies.set(SESSION_COOKIE, process.env.NEXTFLOW_STUDIO_SESSION_TOKEN!, { httpOnly: true, sameSite: "strict", path: "/", maxAge: COOKIE_MAX_AGE });
  return response;
}

export const config = {
  // The proxy buffers request bodies (and cuts them at 10 MB), so the streaming upload checks the session itself.
  matcher: ["/((?!api/fs/upload$).*)"],
};
