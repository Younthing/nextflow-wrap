import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { ZodError } from "zod";
import samplesheetSchema from "@/data/samplesheet-schema.json";
import { containedFile, fileResponse, readTail, resultFiles } from "@/features/runs/server/files";
import { summarizeAnnData } from "@/features/runs/server/anndata";
import { previewKind } from "@/features/runs/preview";
import { active, assertSameOrigin, resumable, cancelRun, HttpError, requireRun, resumeRun, runnerReady, submitRun, workflowInput } from "@/features/runs/server/service";
import { handleNotebookApi } from "@/features/notebook/server/http";
import { handleSetupApi } from "@/features/setup/server/http";
import { handleFsApi, handleUpload } from "@/features/files/server/http";
import { handleSettingsApi } from "@/features/settings/server/http";
import { handleStorageApi } from "@/features/storage/server/http";
import { handleDiagnosticsApi } from "@/features/diagnostics/server/http";
import { handleRemoteApi } from "@/features/remote/server/http";
import { handleProjectsApi } from "@/features/workspace/server/http";
import { currentProjectId } from "@/features/workspace/server/projects";
import { remoteTaskLog } from "@/features/remote/server/remote-run";
import { SshSession } from "@/features/remote/server/session";
import { applyStoredSettings, readSettings } from "@/lib/server/settings";
import { API_VERSION, type HealthStatus } from "@/lib/api-types";
import { store } from "@/lib/server/database";

type Context = { params: Promise<{ path: string[] }> };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });

async function handle(request: Request, context: Context): Promise<Response> {
  try {
    const url = new URL(request.url);
    const path = (await context.params).path;
    // Streams past the 2 MB body cap below; it checks the session itself because the proxy skips it.
    if (path.length === 2 && path[0] === "fs" && path[1] === "upload") return handleUpload(request);
    if (request.method !== "GET") {
      // Next.js may normalize request.url to localhost; Host retains the browser's public origin.
      assertSameOrigin(request);
      if (Number(request.headers.get("content-length") ?? 0) > 2 * 1024 ** 2) throw new HttpError(413, "请求过大");
    }
    const [resource, id, action] = path;
    const method = request.method;
    if (resource === "health" && method === "GET") {
      const state = store().runtime();
      const ready = runnerReady();
      return json({ status: ready ? "ok" : "degraded", appVersion: process.env.NEXTFLOW_STUDIO_APP_VERSION, build: process.env.NEXTFLOW_STUDIO_BUILD || undefined, apiVersion: API_VERSION, nextflowVersion: state?.versions?.nextflow ?? "未就绪", mocked: false, runnerReady: !!ready, diagnostics: state?.error ?? (ready ? undefined : "请启动 pnpm runner"), resources: state?.resources } satisfies HealthStatus);
    }
    if (resource === "setup") return handleSetupApi(method, path, request);
    if (resource === "fs") return handleFsApi(method, path, request);
    if (resource === "settings" && !id) return handleSettingsApi(method, request);
    if (resource === "storage") return handleStorageApi(method, path, request);
    if (resource === "diagnostics" && !id) return handleDiagnosticsApi(method, request);
    if (resource === "remotes") return handleRemoteApi(method, path, request);
    if (resource === "projects") return handleProjectsApi(method, path, request);
    if (resource === "notebooks" || resource === "script-modules" || resource === "kernels") return handleNotebookApi(method, path, request);
    if (resource === "schemas" && id === "samplesheet" && method === "GET") return json(samplesheetSchema);
    if (resource === "workflows") {
      // Workflows belong to a project, as notebooks do: the list is the open project's.
      if (!id && method === "GET") {
        const project = currentProjectId(store());
        return json(store().workflows().filter((doc) => project && doc.projectId === project).map((doc) => ({ id: doc.id, name: doc.name, description: doc.description, updatedAt: doc.updatedAt, nodeCount: doc.nodes.length })));
      }
      if (!id && method === "POST") {
        const projectId = currentProjectId(store());
        if (!projectId) throw new HttpError(400, "先打开一个项目");
        const doc = { ...workflowInput(await request.json()), id: randomUUID(), projectId, updatedAt: new Date().toISOString() };
        store().saveWorkflow(doc);
        return json(doc, 201);
      }
      if (id && method === "PUT") {
        // The project is fixed when the workflow is created.
        const incoming = { ...workflowInput(await request.json()), id, projectId: store().workflow(id)?.projectId };
        const result = store().putWorkflow(incoming);
        if (result.status === "missing") throw new HttpError(404, "流程不存在");
        if (result.status === "stale") throw new HttpError(409, "流程已在其他地方更新，请重新打开");
        return json(result.doc);
      }
      const doc = id ? store().workflow(id) : undefined;
      if (!doc) throw new HttpError(404, "流程不存在");
      if (method === "GET") return json(doc);
      if (method === "DELETE") { store().deleteWorkflow(id); return new Response(null, { status: 204 }); }
    }
    if (resource === "runs") {
      if (!id && method === "GET") {
        const workflowId = url.searchParams.get("workflowId");
        return json(store().runs().filter((run) => !workflowId || run.detail.workflowId === workflowId).map((run) => {
          const { id, runName, workflowId, workflowName, status, executor, profile, submittedAt, startedAt, completedAt, progress, errorMessage, phase, remoteHost } = run.detail;
          return { id, runName, workflowId, workflowName, status, executor, profile, submittedAt, startedAt, completedAt, progress, errorMessage, phase, remoteHost, resumable: resumable(run) };
        }));
      }
      if (!id && method === "POST") {
        const key = request.headers.get("idempotency-key") ?? undefined;
        if (key && !/^[\w-]{1,100}$/.test(key)) throw new HttpError(400, "无效的幂等键");
        return json(submitRun(await request.json(), key), 202);
      }
      const run = requireRun(id);
      if (!action && method === "GET") return json(run.detail);
      if (!action && method === "DELETE") {
        if (active(run)) throw new HttpError(409, "请先停止运行");
        store().deleteRun(id);
        return new Response(null, { status: 204 });
      }
      if (action === "cancel" && method === "POST") return json(cancelRun(id));
      if (action === "resume" && method === "POST") return json(resumeRun(id), 202);
      if (action === "tasks" && method === "GET") return json(store().tasks(id));
      if (action === "log" && method === "GET") {
        const text = await readTail(join(run.attemptDir, "console.log")) || await readTail(join(run.projectDir, "install.log"));
        if (url.searchParams.get("download") === "1") return fileResponse(await containedFile(run.attemptDir, "console.log"), true);
        return json({ lines: text.split("\n") });
      }
      if (action === "task-log" && method === "GET") {
        const key = url.searchParams.get("hash");
        const task = store().tasks(id).find((task) => (task.id ?? task.hash) === key || task.hash === key);
        if (!task) throw new HttpError(404, "任务不存在");
        if (!task.workdir) return json({ text: "" });
        if (run.detail.remote) {
          // Task directories of a cluster run stay on its shared filesystem; read them there over ssh.
          const host = readSettings().remotes.find((candidate) => candidate.id === run.detail.remote!.hostId);
          if (!host) throw new HttpError(404, "这个远程集群已在设置页删除，无法读取任务日志");
          applyStoredSettings();
          return json({ text: await remoteTaskLog(new SshSession(host), run.detail.remote, task.workdir) });
        }
        // The runner records the absolute work directory it used.
        const workRoot = run.detail.launch.workDir;
        if (!isAbsolute(workRoot)) throw new HttpError(404, "这次运行还没有工作目录");
        let text = "";
        for (const name of [".command.log", ".command.err", ".command.out", ".command.sh"]) {
          try { text += `\n--- ${name} ---\n${await readTail(await containedFile(workRoot, join(/* turbopackIgnore: true */ task.workdir, name)), 64_000)}`; }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        }
        return json({ text });
      }
      if (action === "results" && method === "GET") {
        if (!path[3]) return json(await resultFiles(run));
        if (path[3] === "content") {
          const path = await containedFile(String(run.detail.params.outdir), url.searchParams.get("path") ?? "");
          const download = url.searchParams.get("download") === "1";
          if (!download && (await stat(path)).size > 10 * 1024 ** 2) throw new HttpError(413, "文件较大，请下载查看");
          return fileResponse(path, download);
        }
        if (path[3] === "summary") {
          const file = await containedFile(String(run.detail.params.outdir), url.searchParams.get("path") ?? "");
          if (previewKind(file) !== "anndata") throw new HttpError(400, "只有 .h5ad 文件有摘要");
          return json(await summarizeAnnData(file));
        }
      }
    }
    throw new HttpError(404, "接口不存在");
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    const status = error instanceof HttpError ? error.status : error instanceof ZodError || error instanceof SyntaxError ? 400 : missing ? 404 : 500;
    if (status === 500) console.error(error);
    return json({ message: error instanceof ZodError ? error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("；") : missing ? "文件尚未生成或不存在" : error instanceof Error ? error.message : "服务端错误" }, status);
  }
}

export { handle as GET, handle as POST, handle as PUT, handle as DELETE };
