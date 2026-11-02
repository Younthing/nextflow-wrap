import { http, HttpResponse } from "msw";

/** Preview mode has no logs to collect; the download is a short text file that says so. */
export const diagnosticsHandlers = [
  http.get("/api/diagnostics", ({ request }) => {
    const run = new URL(request.url).searchParams.get("run");
    const body = `Nextflow Studio 预览模式\n${run ? `运行 ${run}\n` : ""}预览模式没有真实日志；桌面版或 pnpm dev:real 会导出 .tar.gz 诊断包。\n`;
    return new HttpResponse(body, {
      headers: { "content-type": "text/plain; charset=utf-8", "content-disposition": `attachment; filename="nextflow-studio-diagnostics-preview.txt"` },
    });
  }),
];
