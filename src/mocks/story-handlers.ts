import { http, HttpResponse } from "msw";
import { demoWorkflow } from "@/features/workflow/demo";
import { EXAMPLE_MODULES } from "@/features/workflow/example-modules";
import { defaultLaunchConfig } from "@/features/project/launch";
import { NEXTFLOW_VERSION } from "@/features/project/templates";
import type { RunDetail } from "@/features/runs/types";
import { fsHandlers } from "./fs";
import { settingsHandlers } from "./settings";
import { kernelHandlers } from "./kernels";

export const storyWorkflow = {
  ...demoWorkflow("wf_story"),
  id: "wf_story",
  updatedAt: "2026-01-01T12:00:00.000Z",
};
export const storyRun: RunDetail = {
  id: "run_story",
  runName: "tender_curie",
  workflowId: storyWorkflow.id,
  workflowName: storyWorkflow.name,
  status: "succeeded",
  executor: "local",
  profile: "docker",
  submittedAt: "2026-01-01T12:00:00.000Z",
  startedAt: "2026-01-01T12:00:01.000Z",
  completedAt: "2026-01-01T12:01:01.000Z",
  progress: {
    total: 3,
    pending: 0,
    running: 0,
    completed: 3,
    cached: 0,
    failed: 0,
    aborted: 0,
  },
  workflow: storyWorkflow,
  launch: defaultLaunchConfig(),
  params: storyWorkflow.params,
  command: "nextflow run main.nf -profile docker",
  runConfig: "process.executor = 'local'",
  project: {
    name: "studio/scrna",
    files: [{ path: "main.nf", content: "nextflow.enable.dsl = 2" }],
  },
};

/** Deterministic, read-only fixtures. Unknown APIs fail here instead of reaching a runner. */
export const storyHandlers = [
  ...kernelHandlers,
  ...fsHandlers,
  ...settingsHandlers,
  http.get("/api/script-modules", () => HttpResponse.json({ modules: EXAMPLE_MODULES, references: {} })),
  http.get("/api/health", () =>
    HttpResponse.json({
      status: "ok",
      mocked: true,
      nextflowVersion: NEXTFLOW_VERSION,
    }),
  ),
  http.get("/api/copilotkit/status", () =>
    HttpResponse.json({ enabled: false, message: "Storybook 离线示例" }),
  ),
  http.get("/api/workflows", () =>
    HttpResponse.json([
      { ...storyWorkflow, nodeCount: storyWorkflow.nodes.length },
    ]),
  ),
  http.get("/api/workflows/:id", () => HttpResponse.json(storyWorkflow)),
  http.get("/api/runs", () => HttpResponse.json([storyRun])),
  http.get("/api/runs/:id", () => HttpResponse.json(storyRun)),
  http.get("/api/runs/:id/tasks", () => HttpResponse.json([])),
  http.all("/api/*", () =>
    HttpResponse.json(
      { message: "此操作需要显式的 Storybook mock" },
      { status: 501 },
    ),
  ),
];
