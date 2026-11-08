import { cp, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

async function main() {
  const sandbox = await mkdtemp(join(tmpdir(), "studio-project-e2e-"));
  const root = join(sandbox, "analysis");
  await mkdir(join(root, "data"), { recursive: true });
  await writeFile(join(root, "data/input.txt"), "project-relative input\n");
  process.env.NEXTFLOW_STUDIO_DATA_DIR = join(sandbox, "backend");
  process.env.NEXTFLOW_STUDIO_NEXTFLOW_VERSION ??= "26.10.4";
  const { registryStore, withProject, projectStore } = await import("../src/lib/server/database");
  const { handleNotebookApi } = await import("../src/features/notebook/server/http");
  const { emptyWorkflow } = await import("../src/features/workflow/document");
  const { FILE_ID } = await import("../src/features/workflow/builtins");
  const { launchParams } = await import("../src/features/workflow/inputs");
  const { defaultLaunchConfig } = await import("../src/features/project/launch");
  const { submitRun, resumeRun } = await import("../src/features/runs/server/service");
  const { shutdownProjectKernels } = await import("../src/features/notebook/server/kernels");
  const handle = "smoke_project";
  const registry = registryStore();
  registry.saveProject({ id: handle, path: root, name: "smoke", createdAt: new Date().toISOString(), openedAt: new Date().toISOString() });
  const call = (path: string[], body: unknown) => withProject(handle, async () => (await handleNotebookApi("POST", path, new Request("http://studio.local/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }))).json());
  const notebook = await call(["notebooks"], { name: "uppercase", kernel: "python3", filePath: "analysis/nested.ipynb", cells: [
    { id: "input", role: "input", source: "# @input name=input_file type=path\ninput_file = 'data/input.txt'\n" },
    { id: "output", role: "output", source: "# @output name=report type=path pattern=\"result.txt\"\nfrom pathlib import Path\nPath('result.txt').write_text(Path(input_file).read_text().upper())\n" },
  ] });
  const cells = await call(["notebooks", notebook.id, "run"], {});
  assert.equal(cells.kernel.mode, "jupyter");
  assert.equal(await readFile(join(root, "result.txt"), "utf8"), "PROJECT-RELATIVE INPUT\n");
  const receipt = await call(["notebooks", notebook.id, "try-run"], { bindings: [{ port: "input_file", source: "path", value: "data/input.txt" }] });
  assert.equal(receipt.passed, true, receipt.log);
  const definition = await call(["notebooks", notebook.id, "publish"], { name: "uppercase" });
  const workflow = { ...emptyWorkflow("smoke_flow"), projectId: handle, nodes: [
    { id: "read", position: { x: 0, y: 0 }, data: { moduleId: FILE_ID, alias: "READ", widgets: {}, config: {}, settings: { path: "data/input.txt" } } },
    { id: "step", position: { x: 300, y: 0 }, data: { moduleId: definition.id, alias: "UPPER", widgets: {}, config: { publish: true } } },
  ], edges: [{ id: "edge", source: "read", target: "step", sourceHandle: "out:file", targetHandle: "in:input_file" }] };
  withProject(handle, () => projectStore(handle).saveWorkflow(workflow));
  let output = "";
  const runner = spawn(process.execPath, ["--import", "tsx", "scripts/runner.ts"], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  runner.stdout.on("data", (chunk) => { output = (output + chunk).slice(-12000); });
  runner.stderr.on("data", (chunk) => { output = (output + chunk).slice(-12000); });
  const wait = async (condition: () => boolean, label: string) => {
    for (let i = 0; i < 240; i++) { if (condition()) return; if (runner.exitCode !== null || runner.signalCode !== null) throw new Error(output); await new Promise((resolve) => setTimeout(resolve, 500)); }
    throw new Error(`${label} timed out\n${output}`);
  };
  try {
    await wait(() => !!registry.runtime()?.versions && !registry.runtime()?.error, "runner startup");
    const submitted = withProject(handle, () => submitRun({ workflow, params: launchParams(workflow), launch: defaultLaunchConfig() }));
    const copyRoot = join(sandbox, "copy");
    await cp(root, copyRoot, { recursive: true });
    registry.saveProject({ id: "smoke_copy", path: copyRoot, name: "copy", createdAt: new Date().toISOString(), openedAt: new Date().toISOString() });
    assert.equal(projectStore("smoke_copy").run(submitted.id)!.detail.status, "failed");
    await wait(() => ["succeeded", "failed"].includes(projectStore(handle).run(submitted.id)!.detail.status), "workflow");
    const first = projectStore(handle).run(submitted.id)!;
    assert.equal(first.detail.status, "succeeded", first.detail.errorMessage);
    assert.equal(await readFile(join(first.attemptDir, "results/upper/result.txt"), "utf8"), "PROJECT-RELATIVE INPUT\n");
    const resumed = withProject(handle, () => resumeRun(first.detail.id));
    await wait(() => ["succeeded", "failed"].includes(projectStore(handle).run(resumed.id)!.detail.status), "resume");
    assert.equal(projectStore(handle).run(resumed.id)!.detail.status, "succeeded");
    assert.ok(projectStore(handle).tasks(resumed.id).some((task) => task.status === "cached"));
    console.log(JSON.stringify({ root, jupyter: cells.kernel.mode, tryRun: receipt.passed, moduleId: definition.id, first: first.detail.id, resumed: resumed.id, cached: true, copiedProjectIsolated: true }));
  } finally {
    shutdownProjectKernels(handle);
    runner.kill("SIGTERM");
    console.log("Runner log:", output.slice(-1000));
  }
}
main().catch(async (error) => {
  (await import("../src/features/notebook/server/kernels")).shutdownProjectKernels("smoke_project");
  console.error(error);
  process.exitCode = 1;
});
