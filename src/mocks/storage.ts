import { http, HttpResponse } from "msw";

import { sampleStorageReport } from "@/features/storage/samples";

let report = sampleStorageReport();

export const storageHandlers = [
  http.get("/api/storage", () => HttpResponse.json(report)),
  http.post("/api/storage/sessions/:key/clean", ({ params }) => {
    const session = report.sessions.find((item) => item.key === params.key);
    if (!session) return HttpResponse.json({ message: "没有这个会话" }, { status: 404 });
    if (session.active) return HttpResponse.json({ message: "运行还没有结束" }, { status: 409 });
    const freed = session.reclaimableBytes;
    report = { ...report, sessions: report.sessions.map((item) => item.key === session.key ? { ...item, workDirs: 0, workBytes: 0, reclaimableBytes: 0, cleanedAt: new Date().toISOString() } : item) };
    return HttpResponse.json({ key: session.key, removedDirs: session.workDirs, freedBytes: freed, affectedRuns: session.runs.map((run) => run.id), removedResults: false });
  }),
];
