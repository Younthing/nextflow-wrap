import { delay, http, HttpResponse } from "msw";

import type { HealthStatus } from "@/lib/api-types";

export const handlers = [
  http.get("/api/health", async () => {
    await delay(150);
    return HttpResponse.json<HealthStatus>({
      status: "ok",
      nextflowVersion: "25.10.0",
      mocked: true,
    });
  }),
];
