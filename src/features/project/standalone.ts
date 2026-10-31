import { planNodes, renderDataflow, renderTemporaryModuleText } from "./workflow-script";
import type { ModuleIndex } from "@/features/workflow/catalog";
import type { ChannelElement, ModuleDef, PortDef, WorkflowDoc, WorkflowNode } from "@/features/workflow/types";

/**
 * A self-contained script with the same channel wiring as the generated
 * workflow, and a local process in place of each nf-core module. Used to run
 * the generated dataflow without containers or the nf-core template.
 */

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function safe(name: string, fallback: string): string {
  return IDENT.test(name) ? name : fallback;
}

function inputDecl(port: PortDef, names: Map<ChannelElement, string>): string {
  if (port.widget) return `val ${safe(port.name, "value")}`;
  if (port.elements.length === 1 && port.elements[0].kind !== "meta") {
    const el = port.elements[0];
    const name = names.get(el) ?? safe(el.name, port.name);
    return el.kind === "value" ? `val ${name}` : `path ${name}`;
  }
  const parts = port.elements.map((el) => {
    const name = names.get(el) ?? safe(el.name, "value");
    if (el.kind === "meta" || el.kind === "value") return `val(${name})`;
    return `path(${name})`;
  });
  return `tuple ${parts.join(", ")}`;
}

function assignNames(def: ModuleDef): Map<ChannelElement, string> {
  const used = new Set<string>();
  const names = new Map<ChannelElement, string>();
  const claim = (el: ChannelElement, fallback: string) => {
    let name = safe(el.name, fallback);
    if (used.has(name)) {
      let i = 2;
      while (used.has(`${name}_${i}`)) i += 1;
      name = `${name}_${i}`;
    }
    used.add(name);
    names.set(el, name);
  };
  def.inputs.forEach((port, index) => {
    if (port.widget) return;
    port.elements.forEach((el, elIndex) => claim(el, `${port.name}_${index}_${elIndex}`));
  });
  return names;
}

function payload(def: ModuleDef, names: Map<ChannelElement, string>): string {
  const bits: string[] = [];
  for (const port of def.inputs) {
    if (port.widget) continue;
    for (const el of port.elements) {
      const name = names.get(el);
      if (!name) continue;
      bits.push(el.kind === "meta" ? `\${${name}.id}` : `\${${name}}`);
    }
  }
  return bits.join(" ") || "-";
}

function stubProcess(node: WorkflowNode, def: ModuleDef): string {
  const alias = node.data.alias;
  const names = assignNames(def);
  const optional = new Set(
    String(node.data.config.optionalOutputs ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  );
  const touch = String(node.data.settings?.touch ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const lines = [`process ${alias} {`, "    debug true"];
  if (def.inputs.length) {
    lines.push("    input:");
    for (const port of def.inputs) lines.push(`    ${inputDecl(port, names)}`);
  }

  const files: { name: string; optional: boolean }[] = [];
  if (def.outputs.length) {
    lines.push("    output:");
    def.outputs.forEach((port, index) => {
      const isOptional = optional.has(port.name);
      const opt = isOptional ? ", optional: true" : "";
      if (index === 0 && touch.length) {
        lines.push(`    path '*', emit: ${safe(port.name, "out")}${opt}`);
        for (const name of touch) files.push({ name, optional: isOptional });
        return;
      }
      if (port.elements.length === 1 && port.elements[0].kind === "file") {
        const filename = `${safe(port.name, "out")}.txt`;
        lines.push(`    path '${filename}', emit: ${safe(port.name, "out")}${opt}`);
        files.push({ name: filename, optional: isOptional });
        return;
      }
      if (port.elements.length === 1 && port.elements[0].kind === "value") {
        const literal = String(node.data.settings?.emit ?? "DATA").replaceAll("'", "");
        lines.push(`    val '${literal}', emit: ${safe(port.name, "out")}`);
        return;
      }
      const metaName = [...names.entries()].find(([element]) => element.kind === "meta")?.[1];
      const parts = port.elements.map((el, elIndex) => {
        if (el.kind === "meta") return `val(${metaName ?? "meta"})`;
        if (el.kind === "value") return `val(${safe(el.name, `v${elIndex}`)})`;
        const filename = `${safe(port.name, "out")}_${elIndex}.txt`;
        files.push({ name: filename, optional: isOptional });
        return `path('${filename}')`;
      });
      lines.push(`    tuple ${parts.join(", ")}, emit: ${safe(port.name, "out")}${opt}`);
    });
  }

  const key = alias.toLowerCase();
  const needsMeta = def.outputs.some((port) => port.elements.some((el) => el.kind === "meta"));
  const hasMetaInput = [...names.entries()].some(([el]) => el.kind === "meta");
  lines.push("    script:");
  if (needsMeta && !hasMetaInput) lines.push("    def meta = [id: 'opt']");
  lines.push(`    def fail = params.containsKey('fail_${key}') ? params.fail_${key} : false`);
  lines.push(`    def omit = params.containsKey('omit_${key}') ? params.omit_${key} : false`);
  lines.push('    """');
  lines.push(`    echo "TASK ${alias} mem=\${task.memory} cpus=\${task.cpus} ${payload(def, names)}"`);
  lines.push('    if [ "${fail}" == "true" ]; then');
  lines.push("        exit 1");
  lines.push("    fi");
  for (const file of files) {
    const write = `echo ${alias} > '${file.name.replaceAll("'", "")}'`;
    if (file.optional) {
      lines.push('    if [ "${omit}" != "true" ]; then');
      lines.push(`        ${write}`);
      lines.push("    fi");
    } else {
      lines.push(`    ${write}`);
    }
  }
  lines.push('    """');
  lines.push("}");
  return lines.join("\n");
}

export function standaloneScript(doc: WorkflowDoc, index: ModuleIndex): string {
  const { order } = planNodes(doc, index);
  const steps = renderDataflow(doc, index);
  const stubs = order.filter((planned) => !planned.def.builtin).map((planned) => stubProcess(planned.node, planned.def));
  const temporary = renderTemporaryModuleText(doc, index);
  const samplesheet = steps.includes("ch_samplesheet")
    ? `def ch_samplesheet = channel.of(
        tuple([id: 'S1', single_end: true], [file(params.sample, checkIfExists: true)])
    )\n`
    : "";
  return `nextflow.enable.dsl=2

${[...stubs, temporary].filter(Boolean).join("\n\n")}

workflow {
    ${samplesheet}
${steps
  .split("\n")
  .map((line) => (line ? `    ${line}` : line))
  .join("\n")}
}
`;
}
