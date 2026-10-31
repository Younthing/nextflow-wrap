import { gstr, indent } from "./groovy";
import {
  BUFFER_ID,
  COLLECT_FILE_ID,
  COLLECT_ID,
  COMBINE_ID,
  CREATE_KEY_ID,
  CSV_ID,
  FILE_PAIRS_ID,
  FILE_PATH_ID,
  FILE_RANGE_ID,
  FLATTEN_ID,
  GROUP_ID,
  JOIN_ID,
  SPLIT_TEXT_ID,
  operatorChannel,
} from "@/features/workflow/operators";
import type { ModuleDef, WidgetValue, WorkflowNode } from "@/features/workflow/types";

export class ChannelOpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChannelOpError";
  }
}

const fail = (message: string): never => {
  throw new ChannelOpError(message);
};

/** Parenthesise an expression so another operator can be chained onto it. */
export function paren(expr: string): string {
  const trimmed = expr.trim();
  if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(trimmed)) return trimmed;
  if (!trimmed.includes("\n")) return `(${trimmed})`;
  return `(\n${indent(trimmed, 4)}\n)`;
}

function setting(node: WorkflowNode, key: string, fallback: WidgetValue): WidgetValue {
  const value = node.data.settings?.[key];
  return value === undefined || value === "" ? fallback : value;
}

function text(node: WorkflowNode, key: string, fallback = ""): string {
  return String(setting(node, key, fallback));
}

function integer(node: WorkflowNode, key: string, fallback: number): number {
  const value = setting(node, key, fallback);
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) fail(`${node.data.alias} 的 ${key} 需要非负整数`);
  return parsed;
}

function flag(node: WorkflowNode, key: string, fallback: boolean): boolean {
  const value = node.data.settings?.[key];
  if (value === undefined || value === "") return fallback;
  return value === true || value === "true";
}

const PARAM = /^[a-z][a-z0-9_]*$/;

function paramOrGlob(node: WorkflowNode, fallbackParam: string): string {
  const glob = text(node, "glob").trim();
  if (glob) return gstr(glob);
  const name = text(node, "param", fallbackParam).trim();
  if (!PARAM.test(name)) fail(`${node.data.alias} 的参数名 "${name}" 无效`);
  return `params.${name}`;
}

/** `{n}` in a path template becomes the range index. */
function rangePath(template: string): string {
  const body = template.replaceAll("{n}", "${n}").replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `"${body}"`;
}

function header(node: WorkflowNode, def: ModuleDef): string {
  return `//\n// OPERATOR: ${node.data.alias} (${def.id})\n//`;
}

function assign(node: WorkflowNode, def: ModuleDef, expr: string): string {
  const name = operatorChannel(node.data.alias, def.outputs[0]?.name ?? "out", 1);
  return `${header(node, def)}\ndef ${name} = ${expr}`;
}

/**
 * File name, not the directory. Path channels use `name`; plain strings (the
 * pattern's sample filenames) use the string itself.
 */
const FILE_TEXT = "item instanceof java.nio.file.Path ? item.name : item.toString()";

function createKey(node: WorkflowNode, input: string): string {
  const separator = text(node, "separator", "_");
  if (!separator) fail(`${node.data.alias} 需要一个分隔符`);
  const index = integer(node, "index", 0);
  const separator2 = text(node, "separator2").trim();
  const index2 = integer(node, "index2", 0);
  const second = separator2
    ? `\n    key = key.split(${gstr(separator2)})[${index2}]`
    : "";
  return `${paren(input)}.map { item ->
    def key = ${FILE_TEXT}
    key = key.split(${gstr(separator)})[${index}]${second}
    [ [id: key], item ]
}`;
}

function align(node: WorkflowNode, def: ModuleDef, left: string, right: string, how: "join" | "combine"): string {
  const base = `ch_${node.data.alias.toLowerCase()}`;
  const keyed = (expr: string) => `${paren(expr)}.map { meta, file -> [meta.id, meta, file] }`;
  const paired =
    how === "join"
      ? `${keyed(left)}.join(${keyed(right)}, by: 0)`
      : `${keyed(left)}.combine(${keyed(right)}, by: 0)`;
  return `${header(node, def)}
def ${base} = ${paired}
def ${base}_left = ${base}.map { id, meta, file, meta2, file2 -> [meta, file] }
def ${base}_right = ${base}.map { id, meta, file, meta2, file2 -> [meta2, file2] }`;
}

function group(input: string): string {
  return `${paren(input)}
    .map { meta, file -> [meta.id, meta, file] }
    .groupTuple(by: 0)
    .map { id, metas, files -> [metas[0], files.sort { a, b -> a.toString() <=> b.toString() }] }`;
}

function fromFilePairs(node: WorkflowNode): string {
  const target = paramOrGlob(node, "reads");
  const check = flag(node, "check", true);
  const grouping = text(node, "grouping").trim();
  const closure = !grouping ? "" : grouping.startsWith("{") ? ` ${grouping}` : ` { ${grouping} }`;
  return `Channel.fromFilePairs(${target}, checkIfExists: ${check})${closure}
    .map { sampleId, reads -> [[id: sampleId], reads] }`;
}

function fromRange(node: WorkflowNode): string {
  const start = integer(node, "start", 1);
  const end = integer(node, "end", start);
  if (end < start) fail(`${node.data.alias} 的结束序号不能小于起始序号`);
  const prefix = text(node, "prefix", "sample").replaceAll('"', "");
  const left = text(node, "left", "/data/foo.{n}.indels.vcf");
  const right = text(node, "right", "/data/foo.snvs.{n}.vcf");
  return `Channel.from(${start}..${end}).map { n ->
    [[id: "${prefix}\${n}"], file(${rangePath(left)}), file(${rangePath(right)})]
}`;
}

function fromCsv(node: WorkflowNode): string {
  const target = paramOrGlob(node, "index");
  const id = text(node, "id", "sampleId").trim();
  const read1 = text(node, "read1", "read1").trim();
  const read2 = text(node, "read2", "read2").trim();
  if (!id || !read1 || !read2) fail(`${node.data.alias} 需要样本列和两个文件列`);
  return `Channel.fromPath(${target}, checkIfExists: true)
    .splitCsv(header: true)
    .map { row ->
        [[id: row[${gstr(id)}]], file(row[${gstr(read1)}], checkIfExists: true), file(row[${gstr(read2)}], checkIfExists: true)]
    }`;
}

/** Groovy for one operator node. `input(port)` is the upstream channel expression. */
export function renderOperator(node: WorkflowNode, def: ModuleDef, input: (port: string) => string): string {
  const read = (port: string) => input(port);
  switch (def.id) {
    case CREATE_KEY_ID:
      return assign(node, def, createKey(node, read("item")));
    case COMBINE_ID:
      return align(node, def, read("left"), read("right"), "combine");
    case JOIN_ID:
      return align(node, def, read("left"), read("right"), "join");
    case COLLECT_ID:
      return assign(node, def, `${paren(read("items"))}.collect().ifEmpty([])`);
    case GROUP_ID:
      return assign(node, def, group(read("items")));
    case COLLECT_FILE_ID: {
      const name = text(node, "name", "collected.txt").trim() || "collected.txt";
      return assign(node, def, `${paren(read("items"))}.collectFile(name: ${gstr(name)})`);
    }
    case FLATTEN_ID:
      return assign(node, def, `${paren(read("items"))}.flatten()`);
    case SPLIT_TEXT_ID: {
      const size = integer(node, "size", 5);
      const asFile = flag(node, "file", true);
      return assign(node, def, `${paren(read("file"))}.splitText(by: ${size}, file: ${asFile})`);
    }
    case BUFFER_ID: {
      const size = Math.max(1, integer(node, "size", 10));
      return assign(node, def, `${paren(read("items"))}.buffer(size: ${size}, remainder: true)`);
    }
    case CSV_ID:
      return assign(node, def, fromCsv(node));
    case FILE_PAIRS_ID:
      return assign(node, def, fromFilePairs(node));
    case FILE_PATH_ID: {
      const target = paramOrGlob(node, "files");
      const check = flag(node, "check", true);
      return assign(node, def, `Channel.fromPath(${target}, checkIfExists: ${check})`);
    }
    case FILE_RANGE_ID:
      return assign(node, def, fromRange(node));
    default:
      return fail(`未知算子 ${def.id}`);
  }
}
