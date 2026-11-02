import { delay, http, HttpResponse } from "msw";

import { sampleSetupStatus } from "@/features/setup/samples";

/** The demo backend reports a ready machine; installs are accepted and do nothing. */
export const setupHandlers = [
  http.get("/api/setup", async () => {
    await delay(200);
    return HttpResponse.json(sampleSetupStatus("ready"));
  }),
  http.post("/api/setup/install", () => HttpResponse.json({ started: false, message: "演示模式不会安装工具" }, { status: 409 })),
];
