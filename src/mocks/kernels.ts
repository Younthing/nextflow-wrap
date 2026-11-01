import { delay, http, HttpResponse } from "msw";

import type { KernelInfo, KernelSpecList } from "@/features/notebook/types";

/** Jupyter kernelspecs the mock backend reports. */
export const mockKernelSpecs: KernelSpecList = {
  available: true,
  python: "/usr/bin/python3",
  kernels: [
    { name: "python3", displayName: "Python 3 (ipykernel)", language: "python" },
    { name: "scanpy", displayName: "Python (scanpy)", language: "python" },
  ],
};

const kernels = new Map<string, KernelInfo>();

/** Demo-mode kernel endpoints. State lives in memory; cell runs stay simulated. */
export const kernelHandlers = [
  http.get("/api/kernels", () => HttpResponse.json(mockKernelSpecs)),
  http.get("/api/notebooks/:id/kernel", ({ params }) => {
    const id = params.id as string;
    return HttpResponse.json(kernels.get(id) ?? { notebookId: id, state: "stopped" });
  }),
  http.post("/api/notebooks/:id/kernel", async ({ params, request }) => {
    const id = params.id as string;
    const body = (await request.json().catch(() => ({}))) as { action?: string };
    if (body.action === "shutdown") kernels.delete(id);
    if (body.action === "restart") {
      await delay(200);
      kernels.set(id, { notebookId: id, state: "idle", kernel: "python3", startedAt: new Date().toISOString() });
    }
    return HttpResponse.json(kernels.get(id) ?? { notebookId: id, state: "stopped" });
  }),
];
