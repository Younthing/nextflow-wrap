import { diagnosticsBundle } from "./bundle";

/** `GET /api/diagnostics[?run=<id>]`: a redacted `.tar.gz` for bug reports. */
export async function handleDiagnosticsApi(method: string, request: Request): Promise<Response> {
  if (method !== "GET") return Response.json({ message: "接口不存在" }, { status: 404 });
  // Logs and settings: only for the app itself, never for a page on another site that links here.
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return Response.json({ message: "跨站请求被拒绝" }, { status: 403 });
  const runId = new URL(request.url).searchParams.get("run") ?? undefined;
  const bundle = await diagnosticsBundle({ runId });
  return new Response(new Uint8Array(bundle.data), {
    headers: {
      "content-type": "application/gzip",
      "content-disposition": `attachment; filename="${bundle.name}"`,
      "cache-control": "no-store",
    },
  });
}
