import { NextResponse, type NextRequest } from "next/server";

import { checkSession, SESSION_COOKIE, SESSION_HEADER } from "@/features/desktop/session-guard";

/** In the desktop app, only the app's own window (holding the session cookie) may use this server. */
export function proxy(request: NextRequest) {
  const verdict = checkSession({
    token: process.env.NEXTFLOW_STUDIO_SESSION_TOKEN,
    port: process.env.PORT,
    host: request.headers.get("host"),
    cookie: request.cookies.get(SESSION_COOKIE)?.value,
    header: request.headers.get(SESSION_HEADER),
  });
  if (verdict.ok) return NextResponse.next();
  return new NextResponse(verdict.reason, { status: verdict.status, headers: { "content-type": "text/plain; charset=utf-8" } });
}
