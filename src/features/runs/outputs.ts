/**
 * What a run leaves behind, derived from its simulated tasks: the console
 * log, per-task logs and the files published under `--outdir`. Used by the
 * mock backend; a real backend reads these from the run's work and output
 * directories instead.
 */
import type { ModuleIndex } from "@/features/workflow/catalog";
import { resolveNodeDef } from "@/features/workflow/catalog";
import { NEXTFLOW_VERSION } from "@/features/project/templates";
import { projectMeta } from "@/features/project/generate";
import type { ModuleDef } from "@/features/workflow/types";
import { SAMPLE_GIF, SAMPLE_JPEG, SAMPLE_PDF, SAMPLE_PNG, SAMPLE_SVG, SAMPLE_WEBP } from "@/features/output/samples";
import { formatBytes, formatDuration } from "./format";
import { SAMPLE_PDB, SAMPLE_PDBQT } from "./molecule-samples";
import { contentTypeOf, previewKind } from "./preview";
import type { ResultFile, RunDetail, TaskRecord } from "./types";
export type { ResultFile } from "./types";

type RunLike = Pick<RunDetail, "id" | "runName" | "workflow" | "params" | "submittedAt" | "launch" | "status" | "completedAt" | "startedAt" | "errorMessage">;

/** Alternative or rarely produced outputs that would clutter the results. */
const SKIPPED_OUTPUTS = new Set(["sam", "cram", "crai", "csi", "reads_fail", "reads_merged", "unpaired", "bam_sorted_aligned", "bedgraph", "fastq"]);

function hashNumber(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A plausible file name for an output glob such as `*_{fastqc.html}` or `*.{bam}`. */
export function fileNameFor(pattern: string, tag: string): string | null {
  if (!pattern || pattern.includes("${")) return `${tag}/`;
  if (pattern === "*/*") return `${tag}/`;
  // A literal name: `report.html` is a file, `star` a directory.
  if (!pattern.includes("*") && !pattern.startsWith(".")) return /\.[A-Za-z0-9]+$/.test(pattern) ? pattern : `${pattern}/`;
  let name = pattern.replace(/^\*/, "").replace(/\{([^}]*)\}/g, (_, alts: string) => alts.split(",").find(Boolean) ?? "");
  name = name.replace(/\*/g, "");
  if (!name) return null;
  return `${tag}${/^[._]/.test(name) ? "" : "."}${name}`;
}

function approxSize(path: string): number {
  const r = hashNumber(path) / 4294967296;
  if (/\.(bam|cram)$/.test(path)) return Math.round((1.5 + r * 4) * 1024 ** 3);
  if (/\.(fastq|fq)\.gz$/.test(path)) return Math.round((0.6 + r * 2) * 1024 ** 3);
  if (/\.(zip|bigWig)$/.test(path)) return Math.round((0.3 + r) * 1024 ** 2);
  if (/\.html$/.test(path)) return Math.round((0.4 + r * 1.2) * 1024 ** 2);
  if (path.endsWith("/")) return Math.round((2 + r * 30) * 1024 ** 3);
  return Math.round((2 + r * 60) * 1024);
}

const timestamp = (iso: string) => iso.slice(0, 19).replace("T", "_").replaceAll(":", "-");

export function versionOf(def: ModuleDef): string {
  // Biocontainers tags look like `tool:1.2.3--build`; mulled multi-tool images carry only a hash.
  return def.container?.match(/:(\d[\w.]*?)--/)?.[1] ?? "—";
}

export function shortName(run: Pick<RunDetail, "workflow">) {
  return projectMeta(run.workflow).shortName;
}

/** Files under `--outdir` as of now: tasks publish when they finish, reports when the run ends. */
export function resultFiles(run: RunLike, tasks: TaskRecord[], index: ModuleIndex): ResultFile[] {
  const files: ResultFile[] = [];
  const nodes = new Map(run.workflow.nodes.map((n) => [n.id, n]));

  for (const task of tasks) {
    if (task.status !== "completed" && task.status !== "cached") continue;
    const node = nodes.get(task.nodeId);
    if (!node || node.data.config.publish === false) continue;
    const def = resolveNodeDef(index, node.data);
    if (!def) continue;
    const dir = node.data.alias.toLowerCase();
    const tag = task.tag ?? dir;

    for (const out of def.outputs) {
      if (SKIPPED_OUTPUTS.has(out.name) || out.name === "versions" || out.name.startsWith("versions_")) continue;
      for (const el of out.elements) {
        if (el.kind !== "file" || !el.pattern) continue;
        const name = fileNameFor(el.pattern, tag);
        if (!name) continue;
        const path = `${dir}/${name}`;
        if (files.some((f) => f.path === path)) continue;
        files.push({ path, size: approxSize(path), preview: previewKind(path), nodeId: node.id });
      }
    }
  }

  if (run.completedAt) {
    const ts = timestamp(run.startedAt ?? run.submittedAt);
    const info = [
      `pipeline_info/execution_trace_${ts}.txt`,
      `pipeline_info/execution_timeline_${ts}.html`,
      `pipeline_info/params_${ts}.json`,
    ];
    for (const path of info) files.push({ path, size: approxSize(path), preview: previewKind(path) });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function traceTable(tasks: TaskRecord[]): string {
  const rows = tasks
    .filter((t) => t.submittedAt)
    .map((t, i) =>
      [
        i + 1,
        t.hash,
        "-",
        t.name,
        t.status.toUpperCase(),
        t.exitStatus ?? "-",
        t.submittedAt ?? "-",
        formatDuration(t.durationMs),
        formatDuration(t.durationMs),
        t.cpuPercent !== undefined ? `${t.cpuPercent}%` : "-",
        formatBytes(t.peakRss),
        "-",
        "-",
      ].join("\t"),
    );
  return ["task_id\thash\tnative_id\tname\tstatus\texit\tsubmit\tduration\trealtime\t%cpu\tpeak_rss\trchar\twchar", ...rows].join("\n") + "\n";
}

const escapeHtml = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const REPORT_CSS = `body{font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;color:#1f2937;background:#fff}
header{background:#1f2937;color:#fff;padding:16px 24px}header h1{margin:0;font-size:20px}header p{margin:4px 0 0;opacity:.75}
main{padding:20px 24px;max-width:1100px}h2{font-size:16px;margin:28px 0 8px;border-bottom:1px solid #e5e7eb;padding-bottom:4px}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{border-bottom:1px solid #eef0f3;padding:6px 8px;text-align:left}
th{background:#f8fafc;font-weight:600}td.n{text-align:right;font-variant-numeric:tabular-nums}
.bar{height:10px;border-radius:3px;background:#3b82f6}.muted{color:#6b7280;font-size:12px}`;

function timelineReport(run: RunLike, tasks: TaskRecord[]): string {
  const ran = tasks.filter((t) => t.startedAt);
  const t0 = Math.min(...ran.map((t) => Date.parse(t.submittedAt ?? t.startedAt!)));
  const t1 = Math.max(...ran.map((t) => Date.parse(t.completedAt ?? run.completedAt ?? t.startedAt!)));
  const span = Math.max(1, t1 - t0);
  const color = (t: TaskRecord) => (t.status === "failed" ? "#ef4444" : t.status === "aborted" ? "#f59e0b" : "#3b82f6");
  const rows = ran
    .map((t) => {
      const start = Date.parse(t.startedAt!);
      const end = Date.parse(t.completedAt ?? run.completedAt ?? t.startedAt!);
      const left = ((start - t0) / span) * 100;
      const width = Math.max(0.5, ((end - start) / span) * 100);
      return `<tr><td>${escapeHtml(t.name)}</td><td style="width:60%"><div class="bar" style="margin-left:${left}%;width:${width}%;background:${color(t)}"></div></td><td class="n">${formatDuration(t.durationMs)}</td></tr>`;
    })
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Timeline</title><style>${REPORT_CSS}</style></head><body>
<header><h1>Processes execution timeline</h1><p>${escapeHtml(run.runName)} · ${formatDuration(span)}</p></header>
<main><table><tbody>${rows}</tbody></table></main></body></html>`;
}

function genericText(path: string, task?: TaskRecord): string {
  const who = task ? `${task.name} [${task.hash}]` : "the pipeline";
  if (path.endsWith(".json")) return `${JSON.stringify({ generated_by: who, file: path, simulated: true }, null, 2)}\n`;
  return `# ${path}\n# Written by ${who}.\n# This run was simulated by Nextflow Studio's mock backend, so the content is a placeholder.\n`;
}

export interface ResultBody {
  contentType: string;
  body: string;
  /** Set when `body` is base64 so the mock response can send real bytes. */
  encoding?: "base64";
}

const RASTER_SAMPLES = {
  png: SAMPLE_PNG,
  jpeg: SAMPLE_JPEG,
  gif: SAMPLE_GIF,
  webp: SAMPLE_WEBP,
} as const;

function delimitedPreview(path: string, delimiter: "," | "\t"): string {
  const cell = (value: string) => (delimiter === "," && /[",\n]/.test(value) ? `"${value.replaceAll("\"", "\"\"")}"` : value);
  return [`file${delimiter}value`, `${cell(path)}${delimiter}1`, ""].join("\n");
}

/** Content of a previewable result file, or null when it doesn't exist. */
export function resultContent(
  run: RunLike,
  tasks: TaskRecord[],
  index: ModuleIndex,
  path: string,
): ResultBody | null {
  const file = resultFiles(run, tasks, index).find((f) => f.path === path);
  if (!file || !file.preview) return null;
  const html = (body: string): ResultBody => ({ contentType: "text/html; charset=utf-8", body });
  const text = (body: string, contentType = "text/plain; charset=utf-8"): ResultBody => ({ contentType, body });

  if (path.includes("execution_timeline")) return html(timelineReport(run, tasks));
  if (path.includes("execution_trace")) return text(traceTable(tasks));
  if (path.startsWith("pipeline_info/params_")) return text(`${JSON.stringify(run.params, null, 4)}\n`);
  const task = tasks.find((t) => t.nodeId === file.nodeId && (!t.tag || path.includes(t.tag)));
  if (file.preview === "html") {
    return html(`<!doctype html><html><head><meta charset="utf-8"><style>${REPORT_CSS}</style></head><body><main><h2>${escapeHtml(path)}</h2><p>Report from ${escapeHtml(task?.name ?? "the pipeline")}.</p><p class="muted">Simulated output.</p></main></body></html>`);
  }
  if (file.preview === "markdown") {
    return text(`# ${path}\n\nSimulated output from ${task?.name ?? "the pipeline"}.\n`, "text/markdown; charset=utf-8");
  }
  if (file.preview === "csv" || file.preview === "tsv") {
    const delimiter = file.preview === "tsv" ? "\t" : ",";
    return text(delimitedPreview(path, delimiter), `${contentTypeOf(path)}; charset=utf-8`);
  }
  if (file.preview === "svg") return { contentType: "image/svg+xml", body: SAMPLE_SVG };
  if (file.preview === "pdf") return { contentType: "application/pdf", body: SAMPLE_PDF, encoding: "base64" };
  if (file.preview === "png" || file.preview === "jpeg" || file.preview === "gif" || file.preview === "webp") {
    return { contentType: contentTypeOf(path), body: RASTER_SAMPLES[file.preview], encoding: "base64" };
  }
  if (file.preview === "molecule") return text(/\.pdbqt$/i.test(path) ? SAMPLE_PDBQT : SAMPLE_PDB);
  return text(genericText(path, task));
}

const fmtTime = (iso: string) => new Date(iso).toISOString().slice(11, 19);

/** Console output as `nextflow run -ansi-log false` prints it. */
export function consoleLog(run: RunLike, tasks: TaskRecord[], now = Date.now()): string[] {
  const meta = projectMeta(run.workflow);
  const lines = [
    ` N E X T F L O W   ~  version ${NEXTFLOW_VERSION}`,
    "",
    `Launching \`./main.nf\` [${run.runName}] DSL2 - revision: ${hashNumber(run.id).toString(16).slice(0, 10)}`,
    "",
  ];
  if (!run.startedAt) return [...lines, "Resolving the project…"];

  lines.push(
    `${meta.name} v${meta.version}`,
    "------------------------------------------------------",
    ...Object.entries(run.params).map(([k, v]) => `  ${k.padEnd(24)}: ${String(v)}`),
    "------------------------------------------------------",
    "",
  );

  const events: { at: number; line: string }[] = [];
  for (const t of tasks) {
    if (t.submittedAt) events.push({ at: Date.parse(t.submittedAt), line: `[${t.hash}] Submitted process > ${meta.workflowName}:${t.name}` });
    if (t.status === "failed" && t.completedAt) {
      events.push({
        at: Date.parse(t.completedAt),
        line: [
          `ERROR ~ Error executing process > '${meta.workflowName}:${t.name}'`,
          "",
          "Caused by:",
          `  Process \`${meta.workflowName}:${t.name}\` terminated with an error exit status (1)`,
          "",
          "Command exit status:",
          "  1",
          "",
          "Work dir:",
          `  ${t.workdir}`,
          "",
          "Tip: view the complete command output by changing to the process work dir and entering the command `cat .command.out`",
        ].join("\n"),
      });
    }
  }
  events.sort((a, b) => a.at - b.at);
  for (const e of events) if (e.at <= now) lines.push(...e.line.split("\n"));

  if (run.status === "cancelled") lines.push("", "WARN: Killing running tasks — execution aborted by the user");
  if (run.completedAt) {
    const done = tasks.filter((t) => t.status === "completed").length;
    const failed = tasks.filter((t) => t.status === "failed").length;
    const cpuHours = tasks.reduce((sum, t) => sum + ((t.durationMs ?? 0) * t.cpus) / 3_600_000, 0);
    lines.push(
      "",
      `Completed at: ${new Date(run.completedAt).toUTCString()}`,
      `Duration    : ${formatDuration(Date.parse(run.completedAt) - Date.parse(run.startedAt))}`,
      `CPU hours   : ${cpuHours.toFixed(1)}`,
      `Succeeded   : ${done}`,
      ...(failed ? [`Failed      : ${failed}`] : []),
    );
    if (run.status === "succeeded") lines.push("", `-[${meta.name}] Pipeline completed successfully-`);
    else lines.push("", `-[${meta.name}] Pipeline completed with errors-`);
  }
  return lines;
}

/** `.command.log` of one task. */
export function taskLog(task: TaskRecord, def: ModuleDef | undefined): string {
  if (task.status === "pending" || task.status === "submitted") return "";
  const tool = def?.tools[0]?.name ?? task.process.toLowerCase();
  const lines = [
    `[${task.startedAt ? fmtTime(task.startedAt) : "--:--:--"}] ${tool} ${def ? versionOf(def) : ""} started for ${task.tag ?? task.process}`,
    `Using ${task.cpus} CPU${task.cpus > 1 ? "s" : ""}`,
  ];
  if (task.status === "running") lines.push("Processing…");
  if (task.status === "completed") lines.push(`Finished in ${formatDuration(task.durationMs)}, peak memory ${formatBytes(task.peakRss)}`);
  if (task.status === "failed") {
    lines.push(
      `ERROR: ${tool} ran out of memory while processing ${task.tag ?? "the input"}`,
      "Hint: raise the resource label of this node or set process.resourceLimits in run.config",
    );
  }
  if (task.status === "aborted") lines.push("Killed (SIGTERM): the run was stopped");
  return `${lines.join("\n")}\n`;
}
