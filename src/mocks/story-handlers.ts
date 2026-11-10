import { http, HttpResponse } from "msw";
import { fixtureWorkflow } from "@/features/workflow/fixture-workflows";
import { FIXTURE_MODULES } from "@/features/workflow/fixture-modules";
import { defaultLaunchConfig } from "@/features/project/launch";
import { NEXTFLOW_VERSION } from "@/features/project/templates";
import type { RunDetail } from "@/features/runs/types";
import { documentHandlers, fsHandlers } from "./fs";
import { settingsHandlers } from "./settings";
import { storageHandlers } from "./storage";
import { diagnosticsHandlers } from "./diagnostics";
import { remoteHandlers } from "./remotes";
import { kernelHandlers } from "./kernels";
import type { Project, ProjectList } from "@/features/workspace/types";

export const storyWorkflow = {
  ...fixtureWorkflow("wf_story"),
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

export const storyProject: Project = {
  id: "p_story",
  name: "PBMC 单细胞图谱",
  path: "/home/demo/Projects/pbmc-atlas",
  createdAt: "2026-01-01T12:00:00.000Z",
  openedAt: "2026-01-02T12:00:00.000Z",
};

/** Deterministic, read-only fixtures. Unknown APIs fail here instead of reaching a runner. */
export const storyHandlers = [
  ...kernelHandlers,
  // Uploads go into the story project's data/; the bytes are dropped.
  http.post("/api/fs/reserve", async ({ request }) => {
    const { name } = await request.json() as { name: string };
    return HttpResponse.json({ name, path: `${storyProject.path}/data/${name}` }, { status: 201 });
  }),
  http.put("/api/fs/upload", async ({ request }) => {
    const path = new URL(request.url).searchParams.get("path") ?? "";
    return HttpResponse.json({ path: `${storyProject.path}/data/${path}`, bytes: (await request.arrayBuffer()).byteLength }, { status: 201 });
  }),
  ...fsHandlers,
  ...documentHandlers,
  ...settingsHandlers,
  ...storageHandlers,
  ...diagnosticsHandlers,
  ...remoteHandlers,
  http.get("/api/script-modules", () => HttpResponse.json({ modules: FIXTURE_MODULES, references: {} })),
  // Editing a module opens a temporary notebook built from its saved copy.
  http.post("/api/script-modules/edit", async ({ request }) => {
    const { moduleId } = await request.json() as { moduleId: string };
    const now = "2026-01-01T12:00:00.000Z";
    return HttpResponse.json({ id: "nb_edit", name: moduleId, description: "", kernel: "python3", language: "python", cells: [{ id: "c1", role: "code", source: "" }], rev: 1, createdAt: now, updatedAt: now, temporary: true, fromModuleId: moduleId }, { status: 201 });
  }),
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
  http.get("/api/projects", () => HttpResponse.json<ProjectList>({ projects: [storyProject], current: storyProject.id })),
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
