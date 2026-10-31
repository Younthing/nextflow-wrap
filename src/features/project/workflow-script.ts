import { REFERENCE_ID, SAMPLESHEET_ID } from "@/features/workflow/builtins";
import { resolveNodeDef, type ModuleIndex } from "@/features/workflow/catalog";
import { isOperator, operatorChannel } from "@/features/workflow/operators";
import { renderTemporaryProcesses } from "@/features/workflow/test-modules";
import { checkCompatibility, findPort, portFromHandle, socketInputs } from "@/features/workflow/ports";
import type { ModuleDef, PortDef, WorkflowDoc, WorkflowEdge, WorkflowNode } from "@/features/workflow/types";
import { ChannelOpError, paren, renderOperator } from "./channel-ops";
import { gvalue, indent, nf, section } from "./groovy";

export const MULTIQC_ID = "nf-core/multiqc";

export class GenerateError extends Error {
  constructor(
    message: string,
    readonly nodeId?: string,
  ) {
    super(message);
    this.name = "GenerateError";
  }
}

export interface PlannedNode {
  node: WorkflowNode;
  def: ModuleDef;
}

/** Active nodes in dependency order; throws on cycles. */
export function planNodes(doc: WorkflowDoc, index: ModuleIndex): { order: PlannedNode[]; edges: WorkflowEdge[] } {
  const active = new Map<string, PlannedNode>();
  for (const node of doc.nodes) {
    if (node.data.disabled) continue;
    const def = resolveNodeDef(index, node.data);
    if (!def) throw new GenerateError(`未知模块 ${node.data.moduleId}`, node.id);
    active.set(node.id, { node, def });
  }
  const edges = doc.edges.filter((e) => active.has(e.source) && active.has(e.target));

  const indegree = new Map([...active.keys()].map((id) => [id, 0]));
  for (const e of edges) indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
  // Stable order: follow canvas position (left to right, top to bottom) among ready nodes.
  const byPosition = (a: string, b: string) => {
    const pa = active.get(a)!.node.position;
    const pb = active.get(b)!.node.position;
    return pa.x - pb.x || pa.y - pb.y;
  };
  const ready = [...indegree].filter(([, d]) => d === 0).map(([id]) => id).sort(byPosition);
  const order: PlannedNode[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    order.push(active.get(id)!);
    for (const e of edges.filter((x) => x.source === id)) {
      const d = indegree.get(e.target)! - 1;
      indegree.set(e.target, d);
      if (d === 0) {
        ready.push(e.target);
        ready.sort(byPosition);
      }
    }
  }
  if (order.length !== active.size) {
    const stuck = [...indegree].find(([, d]) => d > 0)?.[0];
    throw new GenerateError("流程中有循环连线，Nextflow 不支持环形依赖", stuck);
  }
  return { order, edges };
}

const refParam = (node: WorkflowNode) => String(node.data.settings?.param ?? "");

/** Shapes an upstream tuple to what the input expects (see `Adapter`). */
function adapt(expr: string, from: PortDef, to: PortDef): string {
  const compat = checkCompatibility(from, to);
  if (!compat.ok) throw new GenerateError(compat.reason ?? "连线类型不兼容");
  if (compat.adapter === "strip-meta") {
    const remaining = from.elements.length - 1;
    expr += remaining === 1 ? ".map { tuple -> tuple[1] }" : ".map { tuple -> tuple[1..-1] }";
  }
  const shaped = compat.adapter === "strip-meta" ? from.elements.length - 1 : from.elements.length;
  const missing = to.elements.length - shaped;
  if (missing > 0) {
    expr += `.map { tuple -> tuple + ${missing === 1 ? "[ [] ]" : `[ [] ] * ${missing}`} }`;
  }
  return expr;
}

/**
 * An unconnected secondary input still emits one empty value, so the process
 * runs. `channel.empty()` would emit nothing and the task would never start.
 * `.first()` makes that one empty list a value channel, reused for every sample.
 */
function emptyInput(port: PortDef): string {
  if (port.elements.length === 1 && port.elements[0]?.kind !== "meta") return "Channel.of([]).first()";
  const parts = port.elements.map((el) => (el.kind === "meta" ? "[:]" : "[]"));
  return `Channel.of([ ${parts.join(", ")} ]).first()`;
}

/** Value emitted when an optional output produced no file, so join and collect can finish. */
function emptyMarker(port: PortDef): string {
  if (port.elements.length === 1 && port.elements[0].kind === "value") return "'EMPTY'";
  if (port.elements.length === 1 && port.elements[0].kind !== "meta") return "[]";
  const parts = port.elements.map((el) => (el.kind === "meta" ? "[id: 'empty']" : el.kind === "value" ? "''" : "[]"));
  return `[ ${parts.join(", ")} ]`;
}

function optionalOutputs(node: WorkflowNode): Set<string> {
  return new Set(
    String(node.data.config.optionalOutputs ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  );
}

function sameShape(left: PortDef, right: PortDef): boolean {
  if (left.elements.length !== right.elements.length) return false;
  return left.elements.every((el, index) => {
    const other = right.elements[index];
    if (el.kind !== other.kind) return false;
    if (el.format && other.format && el.format !== other.format) return false;
    return true;
  });
}

interface Feed {
  expr: string;
  from: PortDef;
  bypass: boolean;
  adapted: boolean;
  srcId: string;
  builtin: boolean;
}

interface Context {
  planned: Map<string, PlannedNode>;
  disabled: Map<string, PlannedNode>;
  docEdges: WorkflowEdge[];
  /** Nodes downstream of the samplesheet, i.e. one task per sample. */
  perSample: Set<string>;
  shortName: string;
  order: PlannedNode[];
}

function samplesScope(doc: WorkflowDoc, order: PlannedNode[]): Set<string> {
  const disabled = new Set(doc.nodes.filter((node) => node.data.disabled).map((node) => node.id));
  const active = new Set(order.map((planned) => planned.node.id));
  const scoped = new Set(order.filter((planned) => planned.def.id === SAMPLESHEET_ID).map((planned) => planned.node.id));
  let grew = true;
  while (grew) {
    grew = false;
    for (const edge of doc.edges) {
      if (!scoped.has(edge.source) || scoped.has(edge.target)) continue;
      if (disabled.has(edge.target) || active.has(edge.target)) {
        scoped.add(edge.target);
        grew = true;
      }
    }
  }
  return scoped;
}

function buildContext(doc: WorkflowDoc, index: ModuleIndex, shortName: string): Context {
  const { order } = planNodes(doc, index);
  const disabled = new Map<string, PlannedNode>();
  for (const node of doc.nodes) {
    if (!node.data.disabled) continue;
    const def = resolveNodeDef(index, node.data);
    if (!def) throw new GenerateError(`未知模块 ${node.data.moduleId}`, node.id);
    disabled.set(node.id, { node, def });
  }
  return {
    planned: new Map(order.map((planned) => [planned.node.id, planned])),
    disabled,
    docEdges: doc.edges,
    perSample: samplesScope(doc, order),
    shortName,
    order,
  };
}

function mixExpr(parts: string[]): string {
  return `channel.empty().mix(\n${parts.map((part) => indent(part, 4)).join(",\n")}\n)`;
}

function baseSource(src: PlannedNode, handle: string): string {
  const port = portFromHandle(handle);
  if (src.def.id === SAMPLESHEET_ID) return "ch_samplesheet";
  if (src.def.id === REFERENCE_ID) {
    const param = refParam(src.node);
    return port === "with_meta" ? `ch_${param}_meta` : `ch_${param}`;
  }
  if (isOperator(src.def.id)) return operatorChannel(src.node.data.alias, port, src.def.outputs.length);
  return `${src.node.data.alias}.out.${port}`;
}

function shouldMixSkip(src: PlannedNode, out: PortDef): boolean {
  if (!src.node.data.config.skip) return false;
  const main = socketInputs(src.def)[0];
  return !!main && sameShape(main, out);
}

/** Groovy expression for the channel behind an output handle. */
function sourceExpr(ctx: Context, src: PlannedNode, handle: string): string {
  const out = findPort(src.def, handle, "out");
  if (!out) throw new GenerateError(`${src.node.data.alias} 没有输出 ${portFromHandle(handle)}`, src.node.id);
  let expr = baseSource(src, handle);
  if (shouldMixSkip(src, out)) expr = `${expr}.mix(ch_${src.node.data.alias.toLowerCase()}_bypass)`;
  if (optionalOutputs(src.node).has(out.name)) expr = `${expr}.ifEmpty(${emptyMarker(out)})`;
  return expr;
}

function feedsFor(ctx: Context, node: WorkflowNode, port: PortDef, seen = new Set<string>()): Feed[] {
  if (seen.has(node.id)) throw new GenerateError("禁用节点形成了环", node.id);
  const nextSeen = new Set(seen);
  nextSeen.add(node.id);
  const feeds: Feed[] = [];
  for (const edge of ctx.docEdges) {
    if (edge.target !== node.id || portFromHandle(edge.targetHandle) !== port.name) continue;
    const src = ctx.planned.get(edge.source) ?? ctx.disabled.get(edge.source);
    if (!src) throw new GenerateError(`连线来源 ${edge.source} 不存在`, node.id);
    if (ctx.disabled.has(edge.source)) {
      const bypass = passthrough(ctx, src, edge.sourceHandle, port, nextSeen);
      if (bypass) feeds.push(bypass);
      continue;
    }
    const out = findPort(src.def, edge.sourceHandle, "out");
    if (!out) throw new GenerateError(`${src.node.data.alias} 没有输出 ${portFromHandle(edge.sourceHandle)}`, src.node.id);
    feeds.push({
      expr: sourceExpr(ctx, src, edge.sourceHandle),
      from: out,
      bypass: false,
      adapted: false,
      srcId: src.node.id,
      builtin: !!src.def.builtin,
    });
  }
  return feeds;
}

/** A disabled pass-through hands its upstream channel to whatever it used to feed. */
function passthrough(
  ctx: Context,
  disabled: PlannedNode,
  sourceHandle: string,
  downstream: PortDef,
  seen: Set<string>,
): Feed | null {
  const out = findPort(disabled.def, sourceHandle, "out");
  const main = socketInputs(disabled.def)[0];
  if (!out || !main || !sameShape(main, out)) return null;
  const compat = checkCompatibility(out, downstream);
  if (!compat.ok || compat.adapter === "strip-meta") return null;
  const upstream = feedsFor(ctx, disabled.node, main, seen);
  if (!upstream.length) return null;
  if (downstream.collect) {
    return {
      expr: upstream.length === 1 ? upstream[0].expr : mixExpr(upstream.map((feed) => feed.expr)),
      from: upstream[0].from,
      bypass: true,
      adapted: false,
      srcId: disabled.node.id,
      builtin: true,
    };
  }
  const parts = upstream.map((feed) => (feed.adapted ? feed.expr : adapt(feed.expr, feed.from, downstream)));
  return {
    expr: parts.length === 1 ? parts[0] : mixExpr(parts),
    from: downstream,
    bypass: true,
    adapted: true,
    srcId: disabled.node.id,
    builtin: true,
  };
}

function inputArgument(ctx: Context, { node }: PlannedNode, port: PortDef, isMain: boolean): string {
  if (port.widget) return gvalue(node.data.widgets[port.name]);

  const feeds = feedsFor(ctx, node, port);
  if (feeds.length === 0) {
    if (isMain && node.data.config.whenEmpty) return "channel.empty().ifEmpty('EMPTY')";
    if (isMain) throw new GenerateError(`${node.data.alias} 的主输入 ${port.name} 没有连接`, node.id);
    return emptyInput(port);
  }

  let expr: string;
  if (port.collect) {
    const parts = feeds.map((feed) =>
      feed.from.elements[0]?.kind === "meta" ? `${feed.expr}.map { tuple -> tuple[1..-1] }` : feed.expr,
    );
    const fileSlot = port.elements.findIndex((el) => el.kind === "file");
    const rest = port.elements.length - fileSlot - 1;
    const metaFirst = port.elements[0]?.kind === "meta";
    const mixed = `channel.empty()\n    .mix(\n${parts.map((part) => `        ${part}`).join(",\n")}\n    )\n    .flatten()\n    .collect()`;
    expr =
      !metaFirst && rest === 0
        ? mixed
        : `${mixed}\n    .map { files -> [ ${[metaFirst ? `[ id: '${node.data.alias.toLowerCase()}' ]` : null, "files", ...Array(rest).fill("[]")].filter(Boolean).join(", ")} ] }`;
  } else {
    const parts = feeds.map((feed) => (feed.adapted ? feed.expr : adapt(feed.expr, feed.from, port)));
    if (parts.length > 1 || feeds.some((feed) => feed.bypass)) {
      expr = mixExpr(parts);
    } else {
      const feed = feeds[0];
      expr = parts[0];
      // A one-off product (e.g. a genome index) feeding a per-sample process must
      // become a value channel, or the process would only run for the first sample.
      if (!feed.bypass && !isMain && ctx.perSample.has(node.id) && !ctx.perSample.has(feed.srcId) && !feed.builtin) {
        expr += ".first()";
      }
    }
  }

  if (isMain && node.data.config.whenEmpty && !expr.includes(".ifEmpty(")) expr = `${paren(expr)}.ifEmpty('EMPTY')`;
  return expr;
}

function multiqcCall(ctx: Context, planned: PlannedNode): string {
  const { node, def } = planned;
  const port = def.inputs[0];
  const feeds = feedsFor(ctx, node, port);
  const mixes = feeds.map((feed) =>
    feed.from.elements[0]?.kind === "meta" ? `${feed.expr}.map { tuple -> tuple[1..-1] }` : feed.expr,
  );
  const alias = node.data.alias;
  return nf`//
// MODULE: ${alias} (nf-core/multiqc) — collects reports, software versions and the run summary
//
ch_multiqc_files = ch_multiqc_files.mix(
${mixes.map((m) => `    ${m}`).join(",\n")}
)
ch_multiqc_files = ch_multiqc_files.mix(ch_collated_versions)
def ch_summary_params = paramsSummaryMap(workflow, parameters_schema: "nextflow_schema.json")
def ch_workflow_summary = channel.value(paramsSummaryMultiqc(ch_summary_params))
ch_multiqc_files = ch_multiqc_files.mix(ch_workflow_summary.collectFile(name: 'workflow_summary_mqc.yaml'))
def ch_multiqc_custom_methods_description = multiqc_methods_description
    ? file(multiqc_methods_description, checkIfExists: true)
    : file("@{projectDir}/assets/methods_description_template.yml", checkIfExists: true)
def ch_methods_description = channel.value(methodsDescriptionText(ch_multiqc_custom_methods_description))
ch_multiqc_files = ch_multiqc_files.mix(ch_methods_description.collectFile(name: 'methods_description_mqc.yaml', sort: true))

${alias} (
    ch_multiqc_files.flatten().collect().map { files ->
        [
            [ id: '${ctx.shortName}' ],
            files,
            multiqc_config
                ? file(multiqc_config, checkIfExists: true)
                : file("@{projectDir}/assets/multiqc_config.yml", checkIfExists: true),
            multiqc_logo ? file(multiqc_logo, checkIfExists: true) : [],
            [],
            [],
        ]
    }
)`;
}

function referenceChannels(ctx: Context, planned: PlannedNode): string {
  const param = refParam(planned.node);
  const optional = planned.node.data.settings?.optional === true;
  const used = new Set(
    ctx.docEdges.filter((edge) => edge.source === planned.node.id).map((edge) => portFromHandle(edge.sourceHandle)),
  );
  const lines = [`// Reference --${param} (${planned.node.data.alias})`];
  const fileExpr = optional
    ? `params.${param} ? channel.value(file(params.${param}, checkIfExists: true)) : channel.value([])`
    : `channel.value(file(params.${param}, checkIfExists: true))`;
  const metaExpr = optional
    ? `params.${param} ? channel.value([ [ id: file(params.${param}).baseName ], file(params.${param}, checkIfExists: true) ]) : channel.value([])`
    : `channel.value([ [ id: file(params.${param}).baseName ], file(params.${param}, checkIfExists: true) ])`;
  if (used.has("file") || used.size === 0) lines.push(`def ch_${param} = ${fileExpr}`);
  if (used.has("with_meta")) lines.push(`def ch_${param}_meta = ${metaExpr}`);
  return lines.join("\n");
}

function skipPrelude(ctx: Context, planned: PlannedNode, port: PortDef): string {
  const raw = inputArgument(ctx, planned, port, true);
  const name = planned.node.data.alias.toLowerCase();
  return [
    `def ch_${name}_upstream = ${paren(raw)}`,
    `def ch_${name}_in = params.skip_${name}?.toString() == 'true' ? channel.empty() : ch_${name}_upstream`,
    `def ch_${name}_bypass = params.skip_${name}?.toString() == 'true' ? ch_${name}_upstream : channel.empty()`,
    "",
  ].join("\n");
}

function moduleCall(ctx: Context, planned: PlannedNode): string {
  const { node, def } = planned;
  const firstSocket = def.inputs.findIndex((port) => !port.widget);
  const skip = !!node.data.config.skip && firstSocket >= 0;
  const name = node.data.alias.toLowerCase();
  const args = def.inputs.map((port, index) => {
    const value = skip && index === firstSocket ? `ch_${name}_in` : inputArgument(ctx, planned, port, index === firstSocket);
    const arg = indent(value, 4).trimStart();
    const comma = index < def.inputs.length - 1 ? "," : "";
    // The comment goes after the comma, or it would swallow it.
    return `${arg}${comma}${port.widget ? ` // ${port.name}` : ""}`;
  });
  const prelude = skip ? skipPrelude(ctx, planned, def.inputs[firstSocket]) : "";
  const header = `//\n// MODULE: ${node.data.alias} (${def.id})\n//`;
  const call = args.length === 0 ? `${node.data.alias} ()` : `${node.data.alias} (\n${args.map((arg) => `    ${arg}`).join("\n")}\n)`;
  return `${prelude}${header}\n${call}`;
}

function operatorCall(ctx: Context, planned: PlannedNode): string {
  try {
    return renderOperator(planned.node, planned.def, (name) => {
      const port = planned.def.inputs.find((item) => item.name === name);
      if (!port) throw new GenerateError(`${planned.node.data.alias} 没有输入 ${name}`, planned.node.id);
      const first = planned.def.inputs.find((item) => !item.widget);
      return inputArgument(ctx, planned, port, port === first);
    });
  } catch (error) {
    if (error instanceof ChannelOpError) throw new GenerateError(error.message, planned.node.id);
    throw error;
  }
}

function renderSteps(ctx: Context): string[] {
  const steps: string[] = [];
  for (const planned of ctx.order) {
    if (planned.def.id === SAMPLESHEET_ID || planned.def.id === MULTIQC_ID) continue;
    if (planned.def.id === REFERENCE_ID) steps.push(referenceChannels(ctx, planned));
    else if (isOperator(planned.def.id)) steps.push(operatorCall(ctx, planned));
    else steps.push(moduleCall(ctx, planned));
  }
  return steps;
}

/** Channel and process calls, without the nf-core versions boilerplate. */
export function renderDataflow(doc: WorkflowDoc, index: ModuleIndex): string {
  return renderSteps(buildContext(doc, index, "pipeline")).join("\n\n");
}

/** Inline host-command processes. Empty when the canvas has none. */
export function renderTemporaryModuleText(doc: WorkflowDoc, index: ModuleIndex): string {
  return renderTemporaryProcesses(planNodes(doc, index).order);
}

export function workflowIncludes(order: PlannedNode[]): string[] {
  const modules = order.filter((p) => !p.def.builtin);
  const width = Math.max(...modules.map((p) => (p.def.process === p.node.data.alias ? p.def.process.length : `${p.def.process} as ${p.node.data.alias}`.length)), 22);
  return modules.map(({ node, def }) => {
    const name = def.process === node.data.alias ? def.process : `${def.process} as ${node.data.alias}`;
    return `include { ${name.padEnd(width)} } from '../modules/nf-core/${def.path}/main'`;
  });
}

export function generateWorkflowScript(
  doc: WorkflowDoc,
  index: ModuleIndex,
  opts: { shortName: string; workflowName: string },
): string {
  const ctx = buildContext(doc, index, opts.shortName);
  const { order } = ctx;
  if (!order.some((planned) => planned.def.id === SAMPLESHEET_ID)) {
    throw new GenerateError("流程需要一个「样本表」节点作为输入");
  }
  const multiqc = order.find((planned) => planned.def.id === MULTIQC_ID);
  const legacyVersions = order.filter((planned) => planned.def.versions === "emit" && planned.def.id !== MULTIQC_ID);

  const body: string[] = [...renderSteps(ctx)];
  if (legacyVersions.length) {
    body.push(
      `// Modules that still emit versions.yml instead of using the versions topic\nch_versions = ch_versions.mix(\n${legacyVersions
        .map((p) => `    ${p.node.data.alias}.out.versions`)
        .join(",\n")}\n)`,
    );
  }
  body.push(nf`//
// Collate and save software versions
//
def topic_versions = channel.topic("versions")
    .distinct()
    .branch { entry ->
        versions_file: entry instanceof Path
        versions_tuple: true
    }

def topic_versions_string = topic_versions.versions_tuple
    .map { process, tool, version ->
        [ process[process.lastIndexOf(':')+1..-1], "  @{tool}: @{version}" ]
    }
    .groupTuple(by:0)
    .map { process, tool_versions ->
        tool_versions.unique().sort()
        "@{process}:\\n@{tool_versions.join('\\n')}"
    }

def ch_collated_versions = softwareVersionsToYAML(ch_versions.mix(topic_versions.versions_file))
    .mix(topic_versions_string)
    .collectFile(
        storeDir: "@{outdir}/pipeline_info",
        name: '${opts.shortName}_software_mqc_versions.yml',
        sort: true,
        newLine: true
    )`);
  if (multiqc) body.push(multiqcCall(ctx, multiqc));

  const includes = [
    ...workflowIncludes(order),
    "include { paramsSummaryMap       } from 'plugin/nf-schema'",
    "include { paramsSummaryMultiqc   } from '../subworkflows/nf-core/utils_nfcore_pipeline'",
    "include { softwareVersionsToYAML } from '../subworkflows/nf-core/utils_nfcore_pipeline'",
    `include { methodsDescriptionText } from '../subworkflows/local/utils_nfcore_${opts.shortName}_pipeline'`,
  ];

  const report = multiqc
    ? `${multiqc.node.data.alias}.out.report.map { _meta, report -> [report] }.toList()`
    : "channel.empty().toList()";

  return nf`/*
${"~".repeat(88)}
    ${opts.workflowName}: generated by Nextflow Studio from "${doc.name}"
    Edit the canvas instead of this file; it is regenerated on every run.
${"~".repeat(88)}
*/

${section("IMPORT MODULES / SUBWORKFLOWS / FUNCTIONS")}

${includes.join("\n")}

${renderTemporaryProcesses(order) ? `${section("TEMPORARY TEST MODULES — not nf-core")}\n\n${renderTemporaryProcesses(order)}\n` : ""}
${section("RUN MAIN WORKFLOW")}

workflow ${opts.workflowName} {

    take:
    ch_samplesheet // channel: [ val(meta), [ reads ] ] read in from --input
    multiqc_config
    multiqc_logo
    multiqc_methods_description
    outdir

    main:

    def ch_versions = channel.empty()
    def ch_multiqc_files = channel.empty()

${body.map((b) => indent(b, 4)).join("\n\n")}

    emit:
    multiqc_report = ${report} // channel: /path/to/multiqc_report.html
    versions       = ch_versions // channel: [ path(versions.yml) ]
}

${section("THE END")}
`;
}
