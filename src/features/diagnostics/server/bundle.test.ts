import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StudioStore, type StoredExecution } from "@/lib/server/database";
import { defaultSettings } from "@/features/settings/types";
import { saveSettings } from "@/lib/server/settings";
import { bundleEntries } from "./bundle";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "studio-diag-"));
  dirs.push(root);
  const db = new StudioStore(join(root, "studio.sqlite"));
  const attemptDir = join(root, "executions", "r1", "attempts", "r1");
  mkdirSync(join(attemptDir, "project"), { recursive: true });
  writeFileSync(join(attemptDir, "console.log"), "N E X T F L O W\nERROR ~ boom\n");
  writeFileSync(join(attemptDir, "run.config"), "aws.secretKey = 'abc'\n");
  writeFileSync(join(attemptDir, "project", "main.nf"), "workflow {}\n");
  const run = {
    lineageId: "r1", projectDir: join(root, "pipelines", "wf"), attemptDir, sessionId: "s1",
    detail: {
      id: "r1", runName: "brave_turing", workflowId: "wf", workflowName: "PBMC", status: "failed", submittedAt: "2026-11-01T00:00:00Z",
      executor: "local", profile: "standard", errorMessage: "boom", launch: { executor: "local" }, progress: {}, params: {},
      project: { name: "p", files: [{ path: "main.nf", content: "x".repeat(10) }] },
      workflow: { id: "wf", name: "PBMC", nodes: [{ id: "n1", data: { moduleId: "m", alias: "QC" } }], edges: [] },
    },
  } as unknown as StoredExecution;
  db.insertRun(run);
  const logs = join(root, "app-logs");
  mkdirSync(logs);
  writeFileSync(join(logs, "web.log"), "listening\n");
  return { root, db, logs };
}

describe("diagnostics bundle", () => {
  it("collects environment, settings, app logs and the run's files with secrets masked", async () => {
    const { root, db, logs } = fixture();
    const env = { PATH: "/usr/bin", NXF_VER: "26.10.4", OPENAI_API_KEY: "sk-proj-abcdefghijklmnopqrstuvwx", NEXTFLOW_STUDIO_LOG_DIR: logs, NEXTFLOW_STUDIO_DATA_DIR: root, UNRELATED: "x", NEXTFLOW_STUDIO_SESSION_TOKEN: "session-token-1234" } as unknown as NodeJS.ProcessEnv;
    saveSettings({ settings: defaultSettings(), secrets: { ANTHROPIC_API_KEY: "anthropic-secret-value" } }, root, env);
    const entries = await bundleEntries({ runId: "r1", db, env, settingsDir: root, setup: async () => ({ ready: true }) });
    const byPath = new Map(entries.map((entry) => [entry.path, entry.text]));

    expect([...byPath.keys()]).toEqual(expect.arrayContaining([
      "summary.json", "environment.json", "setup.json", "settings.json", "logs/app/web.log",
      "run/r1/detail.json", "run/r1/console.log", "run/r1/run.config", "run/r1/project/main.nf", "run/r1/tasks.json",
    ]));
    const environment = JSON.parse(byPath.get("environment.json")!);
    expect(environment).toMatchObject({ PATH: "/usr/bin", NXF_VER: "26.10.4", NEXTFLOW_STUDIO_SESSION_TOKEN: "‹已隐藏›" });
    expect(environment.UNRELATED).toBeUndefined();
    expect(environment.OPENAI_API_KEY).toBeUndefined();
    expect(JSON.parse(byPath.get("summary.json")!).runs).toEqual([expect.objectContaining({ id: "r1", status: "failed", errorMessage: "boom" })]);
    expect(byPath.get("run/r1/detail.json")).not.toContain("xxxxxxxxxx");
    const all = entries.map((entry) => entry.text).join("\n");
    expect(all).not.toMatch(/anthropic-secret-value|abcdefghijklmnop|session-token-1234|'abc'/);
  });

  it("refuses an unknown run", async () => {
    const { db, root } = fixture();
    await expect(bundleEntries({ runId: "nope", db, env: {} as NodeJS.ProcessEnv, settingsDir: root, setup: async () => ({}) })).rejects.toThrow("运行不存在");
  });
});
