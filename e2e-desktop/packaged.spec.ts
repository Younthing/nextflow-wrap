import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { addFileInput, extend, go, notebookModule, runWithShell, shot } from "../e2e/helpers";
import { SCHEMA_VERSION } from "../src/lib/server/schema";
import { defaultSettings } from "../src/features/settings/types";

/**
 * The packaged app end to end: incompatible data is reset on first start, and a notebook published as a
 * module runs through a generated Nextflow project from inside the app, with the web server, runner and kernels
 * hosted by Electron. Needs Java, Nextflow and python3 with ipykernel on the machine, like the web e2e.
 */

const root = resolve(__dirname, "..");

function packagedBinary(): string {
  if (process.env.DESKTOP_APP) return process.env.DESKTOP_APP;
  const release = join(root, "desktop", "release");
  if (process.platform === "darwin") {
    const dir = existsSync(join(release, "mac-arm64")) ? "mac-arm64" : "mac";
    return join(release, dir, "Nextflow Studio.app", "Contents", "MacOS", "Nextflow Studio");
  }
  return join(release, "linux-unpacked", "nextflow-studio-desktop");
}

/** An incompatible development database: no historical schema or migration contract is required. */
function incompatibleDataDirectory(): string {
  const dir = mkdtempSync(join(tmpdir(), "nfs-desktop-incompatible-"));
  const db = new DatabaseSync(join(dir, "studio.sqlite"));
  db.exec(`
    CREATE TABLE workflows (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    PRAGMA user_version=${SCHEMA_VERSION + 1};
  `);
  const workflow = { id: "wf_legacy", name: "旧版本的流程", description: "", version: 1, params: { outdir: "results" }, nodes: [], edges: [], updatedAt: "2026-06-01T00:00:00.000Z" };
  db.prepare("INSERT INTO workflows VALUES (?,?)").run(workflow.id, JSON.stringify(workflow));
  db.close();
  const settings = { ...defaultSettings(), notifications: { runFinished: false } };
  writeFileSync(join(dir, "settings.json"), JSON.stringify(settings));
  mkdirSync(join(dir, "work"));
  writeFileSync(join(dir, "work", "incompatible-task.txt"), "stale task state");
  return dir;
}

async function launch(dataDir: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    executablePath: packagedBinary(),
    args: process.platform === "linux" ? ["--no-sandbox"] : [],
    env: { ...process.env, NEXTFLOW_STUDIO_DATA_DIR: dataDir, NEXTFLOW_STUDIO_DISABLE_UPDATES: "1", NXF_DISABLE_CHECK_LATEST: "true", NXF_ANSI_LOG: "false" } as Record<string, string>,
    timeout: 120_000,
  });
  const page = await app.firstWindow();
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 120_000 });
  return { app, page };
}

test.describe("packaged desktop app", () => {
  let app: ElectronApplication | undefined;
  test.afterEach(async () => {
    // A modal error box (a service that keeps crashing) would block a normal close; kill after 30 seconds.
    const running = app;
    app = undefined;
    if (!running) return;
    const closed = await Promise.race([running.close().then(() => true, () => true), new Promise<false>((resolve) => setTimeout(() => resolve(false), 30_000))]);
    if (!closed) running.process().kill("SIGKILL");
  });

  test("resets incompatible development data and preserves settings", async () => {
    const dataDir = incompatibleDataDirectory();
    const settings = readFileSync(join(dataDir, "settings.json"), "utf8");
    const launched = await launch(dataDir);
    app = launched.app;
    const { page } = launched;
    await go(page, "/workflows");
    await expect(page.getByText("旧版本的流程")).toHaveCount(0);
    await shot(page, "e2e-desktop-reset.png");

    expect(existsSync(join(dataDir, "work", "incompatible-task.txt"))).toBe(false);
    expect(readFileSync(join(dataDir, "settings.json"), "utf8")).toBe(settings);
    const db = new DatabaseSync(join(dataDir, "studio.sqlite"), { readOnly: true });
    try {
      expect(Number(db.prepare("PRAGMA user_version").get()?.user_version)).toBe(SCHEMA_VERSION);
      expect(db.prepare("SELECT id FROM workflows WHERE id=?").get("wf_legacy")).toBeUndefined();
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'").get()).toBeDefined();
    } finally {
      db.close();
    }
  });

  test("runs a published notebook through a generated Nextflow project", async () => {
    test.setTimeout(20 * 60_000);
    const dataDir = mkdtempSync(join(tmpdir(), "nfs-desktop-run-"));
    const input = join(dataDir, "demo", "words.txt");
    mkdirSync(join(dataDir, "demo"), { recursive: true });
    writeFileSync(input, "nextflow studio\n");
    const launched = await launch(dataDir);
    app = launched.app;
    const { page } = launched;
    await go(page, "/workflows");
    await expect(page.getByText(/Nextflow \d/)).not.toContainText("模拟", { timeout: 120_000 });

    const name = `upper_${Date.now().toString(36)}`;
    await notebookModule(page, name, [
      { source: ["# @input name=words type=path required", `words = "${input}"`].join("\n"), role: "input" },
      { source: ["# @output name=upper type=path pattern=upper.txt", "text = open(words).read().upper()", 'open("upper.txt", "w").write(text)', "print(text)"].join("\n"), role: "output" },
    ], [{ cell: 1 }, { cell: 2, text: /NEXTFLOW STUDIO/ }], { port: "words", path: input }, "e2e-desktop");

    await go(page, "/workflows");
    await page.getByRole("button", { name: "新建", exact: true }).click();
    await page.waitForURL(/\/workflows\/(?!modules$)[^/]+$/);
    const reference = await addFileInput(page, input);
    await extend(page, reference, "file", name);
    await expect(page.locator(".react-flow__edge")).toHaveCount(1);
    await expect(page.getByText("已保存", { exact: true })).toBeVisible({ timeout: 20_000 });
    await runWithShell(page);
    await page.getByRole("tab", { name: "结果" }).click();
    await page.getByRole("button", { name: /^upper\.txt/ }).click();
    await expect(page.getByRole("tabpanel", { name: "结果" })).toContainText("NEXTFLOW STUDIO");
    await shot(page, "e2e-desktop-run.png");
  });
});
