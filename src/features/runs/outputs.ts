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
import { formatBytes, formatDuration } from "./format";
import type { RunDetail, TaskRecord } from "./types";

export interface ResultFile {
  /** Path relative to `--outdir`. */
  path: string;
  size: number;
  /** How the UI can show it: plain text, an HTML report, or not at all. */
  preview: "text" | "html" | null;
  /** Canvas node that published it, if any. */
  nodeId?: string;
}

type RunLike = Pick<RunDetail, "id" | "runName" | "workflow" | "params" | "submittedAt" | "launch" | "status" | "completedAt" | "startedAt" | "errorMessage">;

/** Alternative or rarely produced outputs that would clutter the results. */
const SKIPPED_OUTPUTS = new Set(["sam", "cram", "crai", "csi", "reads_fail", "reads_merged", "unpaired", "bam_sorted_aligned", "bedgraph", "fastq"]);

const TEXT_EXT = /\.(txt|log|tsv|csv|json|ya?ml|out|summary|flagstat|stats|metrics|gtf)$/i;

function hashNumber(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A plausible file name for an output glob such as `*_{fastqc.html}` or `*.{bam}`. */
export function fileNameFor(pattern: string, tag: string): string | null {
  if (!pattern || pattern.includes("${")) return `${tag}/`;
  if (pattern === "*/*") return `${tag}/`;
  if (!pattern.includes("*") && !pattern.startsWith(".")) return `${pattern}/`; // a directory like `star`
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

function previewOf(path: string): ResultFile["preview"] {
  if (path.endsWith(".html")) return "html";
  if (TEXT_EXT.test(path)) return "text";
  return null;
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
        const name = def.id === "nf-core/multiqc" ? (out.name === "report" ? "multiqc_report.html" : `multiqc_${out.name}/`) : fileNameFor(el.pattern, tag);
        if (!name) continue;
        const path = `${dir}/${name}`;
        if (files.some((f) => f.path === path)) continue;
        files.push({ path, size: approxSize(path), preview: path.endsWith("/") ? null : previewOf(path), nodeId: node.id });
      }
    }
  }

  if (run.completedAt) {
    const ts = timestamp(run.startedAt ?? run.submittedAt);
    const info = [
      `pipeline_info/execution_trace_${ts}.txt`,
      `pipeline_info/execution_timeline_${ts}.html`,
      `pipeline_info/params_${ts}.json`,
      `pipeline_info/${shortName(run)}_software_mqc_versions.yml`,
    ];
    for (const path of info) files.push({ path, size: approxSize(path), preview: previewOf(path) });
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

function versionsYaml(run: RunLike, tasks: TaskRecord[], index: ModuleIndex): string {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const node of run.workflow.nodes) {
    const def = resolveNodeDef(index, node.data);
    if (!def || def.builtin || seen.has(node.data.alias) || !tasks.some((t) => t.nodeId === node.id)) continue;
    seen.add(node.data.alias);
    lines.push(`${node.data.alias}:`, ...def.tools.map((t) => `  ${t.name}: ${versionOf(def)}`));
  }
  lines.push("Workflow:", `  ${projectMeta(run.workflow).name}: ${projectMeta(run.workflow).version}`, `  Nextflow: ${NEXTFLOW_VERSION}`);
  return `${lines.join("\n")}\n`;
}

const escapeHtml = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const REPORT_CSS = `body{font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;color:#1f2937;background:#fff}
header{background:#1f2937;color:#fff;padding:16px 24px}header h1{margin:0;font-size:20px}header p{margin:4px 0 0;opacity:.75}
main{padding:20px 24px;max-width:1100px}h2{font-size:16px;margin:28px 0 8px;border-bottom:1px solid #e5e7eb;padding-bottom:4px}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{border-bottom:1px solid #eef0f3;padding:6px 8px;text-align:left}
th{background:#f8fafc;font-weight:600}td.n{text-align:right;font-variant-numeric:tabular-nums}
.bar{height:10px;border-radius:3px;background:#3b82f6}.muted{color:#6b7280;font-size:12px}`;

function sampleMetrics(sample: string) {
  const r = (salt: string) => hashNumber(`${sample}:${salt}`) / 4294967296;
  return {
    reads: Math.round(18 + r("reads") * 24),
    q30: 88 + r("q30") * 9,
    gc: 46 + r("gc") * 6,
    dups: 8 + r("dups") * 30,
    mapped: 82 + r("mapped") * 15,
  };
}

/** A small stand-in for MultiQC's report, built from the samples that ran. */
function multiqcReport(run: RunLike, tasks: TaskRecord[], index: ModuleIndex): string {
  const samples = [...new Set(tasks.map((t) => t.tag).filter((t): t is string => !!t))].sort();
  const title = String(run.params.multiqc_title || projectMeta(run.workflow).name);
  const rows = samples
    .map((s) => {
      const m = sampleMetrics(s);
      return `<tr><td>${escapeHtml(s)}</td><td class="n">${m.reads.toFixed(1)} M</td><td class="n">${m.q30.toFixed(1)}%</td><td class="n">${m.gc.toFixed(1)}%</td><td class="n">${m.dups.toFixed(1)}%</td><td class="n">${m.mapped.toFixed(1)}%</td><td style="width:30%"><div class="bar" style="width:${m.mapped}%"></div></td></tr>`;
    })
    .join("");
  const versions = versionsYaml(run, tasks, index)
    .trim()
    .split("\n")
    .filter((l) => l.startsWith("  "))
    .map((l) => l.trim().split(": "))
    .map(([tool, v]) => `<tr><td>${escapeHtml(tool)}</td><td>${escapeHtml(v)}</td></tr>`)
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>MultiQC Report</title><style>${REPORT_CSS}</style></head><body>
<header><h1>${escapeHtml(title)}</h1><p>MultiQC report · run ${escapeHtml(run.runName)} · ${samples.length} samples</p></header>
<main>
<p class="muted">Simulated by Nextflow Studio's mock backend. A real run shows the report MultiQC wrote to <code>multiqc/multiqc_report.html</code>.</p>
<h2>General statistics</h2>
<table><thead><tr><th>Sample</th><th>Reads</th><th>% ≥Q30</th><th>% GC</th><th>% Dups</th><th>% Aligned</th><th></th></tr></thead><tbody>${rows}</tbody></table>
<h2>Software versions</h2>
<table><thead><tr><th>Software</th><th>Version</th></tr></thead><tbody>${versions}</tbody></table>
</main></body></html>`;
}

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

/** Content of a previewable result file, or null when it doesn't exist. */
export function resultContent(
  run: RunLike,
  tasks: TaskRecord[],
  index: ModuleIndex,
  path: string,
): { contentType: string; body: string } | null {
  const file = resultFiles(run, tasks, index).find((f) => f.path === path);
  if (!file || !file.preview) return null;
  const html = (body: string) => ({ contentType: "text/html; charset=utf-8", body });
  const text = (body: string) => ({ contentType: "text/plain; charset=utf-8", body });

  if (path.endsWith("multiqc_report.html")) return html(multiqcReport(run, tasks, index));
  if (path.includes("execution_timeline")) return html(timelineReport(run, tasks));
  if (path.includes("execution_trace")) return text(traceTable(tasks));
  if (path.includes("software_mqc_versions")) return text(versionsYaml(run, tasks, index));
  if (path.startsWith("pipeline_info/params_")) return text(`${JSON.stringify(run.params, null, 4)}\n`);
  const task = tasks.find((t) => t.nodeId === file.nodeId && (!t.tag || path.includes(t.tag)));
  if (file.preview === "html") {
    return html(`<!doctype html><html><head><meta charset="utf-8"><style>${REPORT_CSS}</style></head><body><main><h2>${escapeHtml(path)}</h2><p>Report from ${escapeHtml(task?.name ?? "the pipeline")}.</p><p class="muted">Simulated output.</p></main></body></html>`);
  }
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
  if (!run.startedAt) return [...lines, "Pulling nf-core modules and resolving the project…"];

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
