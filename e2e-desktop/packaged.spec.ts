import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { addReference, extend, go, notebookModule, runWithShell, shot } from "../e2e/helpers";

/**
 * The packaged app end to end: an old data directory is upgraded on first start, and a notebook published as a
 * module runs through a generated Nextflow project from inside the app, with the web server, runner and kernels
 * hosted by Electron. Needs Java, Nextflow and python3 with ipykernel on the machine, like the web e2e.
 */

const root = resolve(__dirname, "..");
const SCHEMA_VERSION = 4;

function packagedBinary(): string {
  if (process.env.DESKTOP_APP) return process.env.DESKTOP_APP;
  const release = join(root, "desktop", "release");
  if (process.platform === "darwin") {
    const dir = existsSync(join(release, "mac-arm64")) ? "mac-arm64" : "mac";
    return join(release, dir, "Nextflow Studio.app", "Contents", "MacOS", "Nextflow Studio");
  }
  return join(release, "linux-unpacked", "nextflow-studio-desktop");
}

/** A data directory as version 2 of the schema left it (before app metadata and version files existed). */
function legacyDataDirectory(): string {
  const dir = mkdtempSync(join(tmpdir(), "nfs-desktop-legacy-"));
  const db = new DatabaseSync(join(dir, "studio.sqlite"));
  db.exec(`
    CREATE TABLE workflows (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE runs (id TEXT PRIMARY KEY, status TEXT NOT NULL, created TEXT NOT NULL, data TEXT NOT NULL, idempotency TEXT UNIQUE, deleted INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE tasks (run_id TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(run_id,id));
    CREATE TABLE events (run_id TEXT NOT NULL, digest TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(run_id,digest));
    CREATE TABLE runtime (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
    CREATE TABLE notebooks (id TEXT PRIMARY KEY, updated TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE notebook_revisions (notebook_id TEXT NOT NULL, rev INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(notebook_id, rev));
    CREATE TABLE script_modules (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE notebook_try_runs (notebook_id TEXT NOT NULL, rev INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(notebook_id, rev));
    PRAGMA user_version=2;
  `);
  const workflow = { id: "wf_legacy", name: "旧版本的流程", description: "", version: 1, params: { outdir: "results" }, nodes: [], edges: [], updatedAt: "2026-06-01T00:00:00.000Z" };
  db.prepare("INSERT INTO workflows VALUES (?,?)").run(workflow.id, JSON.stringify(workflow));
  db.close();
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
  test.afterEach(async () => { await app?.close().catch(() => undefined); app = undefined; });

  test("upgrades a data directory written by an older version", async () => {
    const dataDir = legacyDataDirectory();
    const launched = await launch(dataDir);
    app = launched.app;
    const { page } = launched;
    await go(page, "/workflows");
    await expect(page.getByText("旧版本的流程")).toBeVisible();
    await shot(page, "e2e-desktop-upgraded.png");

    const setup = await page.evaluate(async () => (await fetch("/api/setup")).json() as Promise<{ migration?: { from: number; to: number; backup?: string } }>);
    expect(setup.migration).toMatchObject({ from: 2, to: SCHEMA_VERSION });
    expect(readdirSync(join(dataDir, "backups")).some((name) => name.startsWith("studio-v2-"))).toBe(true);
    expect(existsSync(join(dataDir, "layout.json"))).toBe(true);
    const db = new DatabaseSync(join(dataDir, "studio.sqlite"), { readOnly: true });
    expect(Number(db.prepare("PRAGMA user_version").get()?.user_version)).toBe(SCHEMA_VERSION);
    db.close();
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
    const reference = await addReference(page, "words", input);
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
