import { REFERENCE_ID, SAMPLESHEET_ID } from "@/features/workflow/builtins";
import { resolveNodeDef, type ModuleIndex } from "@/features/workflow/catalog";
import { checkCompatibility, findPort, portFromHandle } from "@/features/workflow/ports";
import type { ModuleDef, PortDef, WorkflowDoc, WorkflowEdge, WorkflowNode } from "@/features/workflow/types";
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

/** Groovy expression for the channel behind an output handle. */
function sourceExpr(src: PlannedNode, handle: string): string {
  const port = portFromHandle(handle);
  if (src.def.id === SAMPLESHEET_ID) return "ch_samplesheet";
  if (src.def.id === REFERENCE_ID) {
    const p = refParam(src.node);
    return port === "with_meta" ? `ch_${p}_meta` : `ch_${p}`;
  }
  return `${src.node.data.alias}.out.${port}`;
}

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

/** Placeholder for an optional input nobody feeds: `[]` or `[ [:], [] ]`. */
function emptyInput(port: PortDef): string {
  const parts = port.elements.map((el) => (el.kind === "meta" ? "[:]" : "[]"));
  return parts.length === 1 ? parts[0] : `[ ${parts.join(", ")} ]`;
}

interface Context {
  planned: Map<string, PlannedNode>;
  edges: WorkflowEdge[];
  /** Nodes downstream of the samplesheet, i.e. one task per sample. */
  perSample: Set<string>;
  shortName: string;
}

function samplesScope(order: PlannedNode[], edges: WorkflowEdge[]): Set<string> {
  const scoped = new Set<string>();
  for (const { node, def } of order) {
    if (def.id === SAMPLESHEET_ID || edges.some((e) => e.target === node.id && scoped.has(e.source))) {
      scoped.add(node.id);
    }
  }
  return scoped;
}

function sourcesFor(ctx: Context, node: WorkflowNode, port: PortDef) {
  return ctx.edges
    .filter((e) => e.target === node.id && portFromHandle(e.targetHandle) === port.name)
    .map((e) => {
      const src = ctx.planned.get(e.source)!;
      const out = findPort(src.def, e.sourceHandle, "out");
      if (!out) throw new GenerateError(`${src.node.data.alias} 没有输出 ${portFromHandle(e.sourceHandle)}`, src.node.id);
      return { edge: e, src, out };
    });
}

function inputArgument(ctx: Context, { node }: PlannedNode, port: PortDef, isMain: boolean): string {
  if (port.widget) return gvalue(node.data.widgets[port.name]);

  const sources = sourcesFor(ctx, node, port);
  if (sources.length === 0) {
    if (isMain) throw new GenerateError(`${node.data.alias} 的主输入 ${port.name} 没有连接`, node.id);
    return emptyInput(port);
  }

  if (port.collect) {
    const parts = sources.map(({ src, edge, out }) => {
      const expr = sourceExpr(src, edge.sourceHandle);
      return out.elements[0]?.kind === "meta" ? `${expr}.map { tuple -> tuple[1..-1] }` : expr;
    });
    const fileSlot = port.elements.findIndex((el) => el.kind === "file");
    const rest = port.elements.length - fileSlot - 1;
    const metaFirst = port.elements[0]?.kind === "meta";
    const mixed = `channel.empty()\n    .mix(\n${parts.map((p) => `        ${p}`).join(",\n")}\n    )\n    .flatten()\n    .collect()`;
    if (!metaFirst && rest === 0) return mixed;
    const tuple = [metaFirst ? `[ id: '${node.data.alias.toLowerCase()}' ]` : null, "files", ...Array(rest).fill("[]")]
      .filter(Boolean)
      .join(", ");
    return `${mixed}\n    .map { files -> [ ${tuple} ] }`;
  }

  if (sources.length > 1) {
    throw new GenerateError(`${node.data.alias} 的输入 ${port.name} 只能接一条连线`, node.id);
  }
  const [{ src, edge, out }] = sources;
  let expr = adapt(sourceExpr(src, edge.sourceHandle), out, port);
  // A one-off product (e.g. a genome index) feeding a per-sample process must
  // become a value channel, or the process would only run for the first sample.
  if (!isMain && ctx.perSample.has(node.id) && !ctx.perSample.has(src.node.id) && !src.def.builtin) {
    expr += ".first()";
  }
  return expr;
}

function multiqcCall(ctx: Context, planned: PlannedNode): string {
  const { node, def } = planned;
  const port = def.inputs[0];
  const sources = sourcesFor(ctx, node, port);
  const mixes = sources.map(({ src, edge, out }) => {
    const expr = sourceExpr(src, edge.sourceHandle);
    return out.elements[0]?.kind === "meta" ? `${expr}.map { tuple -> tuple[1..-1] }` : expr;
  });
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
  const p = refParam(planned.node);
  const used = new Set(
    ctx.edges.filter((e) => e.source === planned.node.id).map((e) => portFromHandle(e.sourceHandle)),
  );
  const lines = [`// Reference --${p} (${planned.node.data.alias})`];
  if (used.has("file") || used.size === 0) {
    lines.push(`def ch_${p} = channel.value(file(params.${p}, checkIfExists: true))`);
  }
  if (used.has("with_meta")) {
    lines.push(
      `def ch_${p}_meta = channel.value([ [ id: file(params.${p}).baseName ], file(params.${p}, checkIfExists: true) ])`,
    );
  }
  return lines.join("\n");
}

function moduleCall(ctx: Context, planned: PlannedNode): string {
  const { node, def } = planned;
  const firstSocket = def.inputs.findIndex((p) => !p.widget);
  const args = def.inputs.map((port, i) => {
    const arg = indent(inputArgument(ctx, planned, port, i === firstSocket), 4).trimStart();
    const comma = i < def.inputs.length - 1 ? "," : "";
    // The comment goes after the comma, or it would swallow it.
    return `${arg}${comma}${port.widget ? ` // ${port.name}` : ""}`;
  });
  const header = `//\n// MODULE: ${node.data.alias} (${def.id})\n//`;
  if (args.length === 0) return `${header}\n${node.data.alias} ()`;
  return `${header}\n${node.data.alias} (\n${args.map((a) => `    ${a}`).join("\n")}\n)`;
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
  const { order, edges } = planNodes(doc, index);
  if (!order.some((p) => p.def.id === SAMPLESHEET_ID)) {
    throw new GenerateError("流程需要一个「样本表」节点作为输入");
  }
  const ctx: Context = {
    planned: new Map(order.map((p) => [p.node.id, p])),
    edges,
    perSample: samplesScope(order, edges),
    shortName: opts.shortName,
  };
  const multiqc = order.find((p) => p.def.id === MULTIQC_ID);
  const legacyVersions = order.filter((p) => p.def.versions === "emit" && p.def.id !== MULTIQC_ID);

  const body: string[] = [];
  for (const planned of order) {
    if (planned.def.id === SAMPLESHEET_ID || planned === multiqc) continue;
    body.push(planned.def.id === REFERENCE_ID ? referenceChannels(ctx, planned) : moduleCall(ctx, planned));
  }
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
