import { mkdtemp, readdir, readFile, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { runCommand } from "@/features/project/server/command";
import { setupStatus } from "@/features/setup/server/setup";
import { HttpError } from "@/features/runs/server/service";
import { store, type StudioStore } from "@/lib/server/database";
import { SCHEMA_VERSION } from "@/lib/server/migrations";
import { dataDirectory } from "@/lib/server/paths";
import { readSecrets, settingsView } from "@/lib/server/settings";
import { managedPaths } from "@/lib/server/toolchain";
import { redactEnv, redactText } from "../redact";

/** Environment variables worth seeing in a bug report. Everything else stays out, secret or not. */
const ENV_KEYS = /^(PATH|HOME|SHELL|LANG|LC_ALL|TMPDIR|JAVA_HOME|NXF_.*|NEXTFLOW_.*|CONDA_.*|MAMBA_.*|DOCKER_.*|HTTPS?_PROXY|NO_PROXY|https?_proxy|no_proxy|PORT|NODE_ENV)$/;
const TAIL_BYTES = 2 * 1024 ** 2;
/** Files of a run attempt that explain what happened. Results and the work directory are left out. */
const RUN_FILES = ["console.log", "nextflow.log", "run.config", "params.json", "trace.tsv", "artifacts.json", "project/main.nf", "project/nextflow.config", "project/conf/base.config", "project/conf/modules.config"];

export interface BundleEntry { path: string; text: string }

async function tail(path: string): Promise<string | undefined> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return undefined;
    const buffer = await readFile(path);
    const text = buffer.subarray(Math.max(0, buffer.length - TAIL_BYTES)).toString("utf8");
    return buffer.length > TAIL_BYTES ? `[只保留最后 ${TAIL_BYTES} 字节]\n${text}` : text;
  } catch { return undefined; }
}

async function logFiles(dir: string | undefined, prefix: string): Promise<BundleEntry[]> {
  if (!dir) return [];
  const names = await readdir(dir).catch(() => [] as string[]);
  const entries: BundleEntry[] = [];
  for (const name of names.filter((name) => name.endsWith(".log")).sort()) {
    const text = await tail(join(dir, name));
    if (text !== undefined) entries.push({ path: `${prefix}/${name}`, text });
  }
  return entries;
}

/** Everything that goes in the bundle, already redacted. Separate from packing so it can be tested. */
export interface BundleOptions {
  runId?: string;
  env?: NodeJS.ProcessEnv;
  db?: StudioStore;
  /** Tool checks; replaced in tests because they spawn java and nextflow. */
  setup?: () => Promise<unknown>;
  settingsDir?: string;
}

export async function bundleEntries(options: BundleOptions = {}): Promise<BundleEntry[]> {
  const env = options.env ?? process.env;
  const secrets = Object.values(readSecrets(options.settingsDir, env)).filter((value): value is string => Boolean(value));
  const entries: BundleEntry[] = [];
  const add = (path: string, value: unknown) => entries.push({ path, text: typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n` });

  const db = options.db ?? store();
  add("summary.json", {
    createdAt: new Date().toISOString(),
    appVersion: env.NEXTFLOW_STUDIO_APP_VERSION ?? "dev",
    desktop: env.NEXTFLOW_STUDIO_DESKTOP === "1",
    platform: `${process.platform}-${process.arch}`,
    node: process.version,
    dataDirectory: dataDirectory({ env }),
    schemaVersion: SCHEMA_VERSION,
    migration: db.migration,
    runner: db.runtime() ?? null,
    runs: db.runs().slice(0, 20).map(({ detail: run }) => ({ id: run.id, status: run.status, submittedAt: run.submittedAt, executor: run.executor, profile: run.profile, errorMessage: run.errorMessage })),
  });
  add("environment.json", redactEnv(Object.fromEntries(Object.entries(env).filter(([name]) => ENV_KEYS.test(name)))));
  add("setup.json", await (options.setup ?? setupStatus)().catch((error: unknown) => ({ error: String(error) })));
  const settings = settingsView(options.settingsDir, env);
  add("settings.json", { settings: settings.settings, secretsSet: settings.secrets, secretStorage: settings.secretStorage, environmentOverrides: settings.environmentOverrides });
  entries.push(...await logFiles(managedPaths().logs, "logs/install"));
  entries.push(...await logFiles(env.NEXTFLOW_STUDIO_LOG_DIR, "logs/app"));

  if (options.runId) {
    const run = db.run(options.runId);
    if (!run) throw new HttpError(404, "运行不存在");
    // The generated project is already in the files below; the full workflow document is reduced to its nodes.
    const { workflow, ...detail } = run.detail;
    delete (detail as Partial<typeof detail>).project;
    add(`run/${run.detail.id}/detail.json`, { ...detail, workflow: { id: workflow.id, name: workflow.name, nodes: workflow.nodes.map((node) => ({ id: node.id, moduleId: node.data.moduleId, alias: node.data.alias })) }, attemptDir: run.attemptDir, sessionId: run.sessionId });
    for (const name of RUN_FILES) {
      const text = await tail(join(/* turbopackIgnore: true */ run.attemptDir, name));
      if (text !== undefined) entries.push({ path: `run/${run.detail.id}/${name}`, text });
    }
    add(`run/${run.detail.id}/tasks.json`, db.tasks(run.detail.id));
  }
  return entries.map((entry) => ({ ...entry, text: redactText(entry.text, secrets) }));
}

/** A `.tar.gz` of `bundleEntries`, built with the system tar (present on macOS and Linux). */
export async function diagnosticsBundle(options: { runId?: string } = {}): Promise<{ name: string; data: Buffer }> {
  const stamp = new Date().toISOString().replaceAll(":", "-").replace(/\..+$/, "");
  const name = `nextflow-studio-diagnostics-${options.runId ? `${options.runId}-` : ""}${stamp}`;
  const scratch = await mkdtemp(join(tmpdir(), "nfs-diag-"));
  try {
    const root = join(scratch, name);
    for (const entry of await bundleEntries(options)) {
      const target = join(root, entry.path);
      await mkdir(join(target, ".."), { recursive: true });
      await writeFile(target, entry.text);
    }
    const archive = join(scratch, `${name}.tar.gz`);
    await runCommand("tar", ["-czf", archive, "-C", scratch, basename(root)], { quiet: true, timeoutMs: 60_000 });
    return { name: `${name}.tar.gz`, data: await readFile(archive) };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
