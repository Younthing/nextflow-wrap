import type { PortDef } from "@/features/workflow/types";
import type {
  CellRef,
  ConvertedNotebook,
  MarkerInput,
  MarkerOutput,
  NotebookCell,
  NotebookDoc,
  NotebookLanguage,
} from "./types";

export class ConvertError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConvertError";
  }
}

const INPUT_RE = /^\s*#\s*@input\b(.*)$/;
const OUTPUT_RE = /^\s*#\s*@output\b(.*)$/;

/** Words, with quoted regions kept in the same token and quotes removed. */
function tokenize(rest: string): string[] {
  const tokens: string[] = [];
  let index = 0;
  while (index < rest.length) {
    while (rest[index] === " ") index += 1;
    if (index >= rest.length) break;
    let token = "";
    while (index < rest.length && rest[index] !== " ") {
      const quote = rest[index];
      if (quote === "\"" || quote === "'") {
        index += 1;
        while (index < rest.length && rest[index] !== quote) token += rest[index++];
        if (rest[index] === quote) index += 1;
        continue;
      }
      token += rest[index++];
    }
    if (token) tokens.push(token);
  }
  return tokens;
}

function fields(rest: string): Map<string, string | true> {
  const map = new Map<string, string | true>();
  for (const token of tokenize(rest)) {
    const eq = token.indexOf("=");
    if (eq === -1) map.set(token, true);
    else map.set(token.slice(0, eq), token.slice(eq + 1));
  }
  return map;
}

function parseInput(rest: string, where: string): MarkerInput {
  const map = fields(rest);
  const name = map.get("name");
  const type = map.get("type");
  if (typeof name !== "string" || !/^[A-Za-z_][\w]*$/.test(name)) {
    throw new ConvertError(`${where}：@input 需要 name=标识符`);
  }
  if (typeof type !== "string") throw new ConvertError(`${where}：@input ${name} 需要 type=`);
  const fallback = map.get("default");
  return {
    name,
    type,
    required: map.has("required") || fallback === undefined,
    defaultValue: typeof fallback === "string" ? fallback : undefined,
  };
}

function parseOutput(rest: string, where: string): MarkerOutput {
  const map = fields(rest);
  const name = map.get("name");
  const type = map.get("type");
  const pattern = map.get("pattern");
  if (typeof name !== "string" || !/^[A-Za-z_][\w]*$/.test(name)) {
    throw new ConvertError(`${where}：@output 需要 name=标识符`);
  }
  if (typeof type !== "string") throw new ConvertError(`${where}：@output ${name} 需要 type=`);
  if (typeof pattern !== "string" || !pattern) throw new ConvertError(`${where}：@output ${name} 需要 pattern=`);
  return { name, type, pattern };
}

function includedRole(role: NotebookCell["role"]): boolean {
  return role === "code" || role === "input" || role === "output";
}

function pyLiteral(value: string, type: string): string {
  if (type === "int" || type === "integer" || type === "float" || type === "number") return value;
  if (type === "bool" || type === "boolean") return value === "true" ? "True" : "False";
  return JSON.stringify(value);
}

function argparseLine(input: MarkerInput): string {
  const flag = `"--${input.name}"`;
  const bits = [flag];
  if (input.type === "path[]" || input.type === "file[]") bits.push('nargs="+"');
  if (input.type === "int" || input.type === "integer") bits.push("type=int");
  else if (input.type === "float" || input.type === "number") bits.push("type=float");
  else if (input.type === "bool" || input.type === "boolean") {
    bits.push('action="store_true"' );
  }
  if (input.defaultValue !== undefined && input.type !== "bool" && input.type !== "boolean") {
    bits.push(`default=${pyLiteral(input.defaultValue, input.type)}`);
  } else if (input.required && input.type !== "bool" && input.type !== "boolean") {
    bits.push("required=True");
  }
  return `p.add_argument(${bits.join(", ")})`;
}

function isValueType(type: string): boolean {
  return ["int", "integer", "float", "number", "str", "string", "bool", "boolean"].includes(type);
}

function widgetFor(type: string): string {
  if (type === "int" || type === "integer") return "integer";
  if (type === "float" || type === "number") return "number";
  if (type === "bool" || type === "boolean") return "boolean";
  return "string";
}

export function inputPorts(inputs: MarkerInput[]): PortDef[] {
  return inputs.map((input) => {
    if (isValueType(input.type)) {
      const widget = widgetFor(input.type);
      return {
        name: input.name,
        description: input.defaultValue !== undefined ? `默认 ${input.defaultValue}` : "参数",
        widget,
        elements: [
          {
            name: input.name,
            type: widget === "integer" ? "integer" : widget === "number" ? "number" : widget === "boolean" ? "boolean" : "string",
            kind: "value",
            description: input.name,
          },
        ],
      };
    }
    return {
      name: input.name,
      description: input.type.endsWith("[]") ? "文件列表" : "文件",
      elements: [{ name: input.name, type: "file", kind: "file", description: input.name }],
    };
  });
}

export function outputPorts(outputs: MarkerOutput[]): PortDef[] {
  return outputs.map((output) => ({
    name: output.name,
    description: output.pattern,
    elements: [{ name: output.name, type: "file", kind: "file", description: output.pattern }],
  }));
}

function stripCell(source: string, inputs: MarkerInput[]): string {
  const names = new Set(inputs.map((input) => input.name));
  return source
    .split("\n")
    .filter((line) => {
      if (INPUT_RE.test(line) || OUTPUT_RE.test(line)) return false;
      const assign = /^([A-Za-z_][\w]*)\s*=/.exec(line);
      return !(assign && names.has(assign[1]));
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function slug(name: string): string {
  const cleaned = name.trim().replace(/\.py$/i, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || "notebook";
}

export function moduleSlug(name: string): string {
  return slug(name);
}

export function commandPreview(entry: string, inputs: MarkerInput[]): string {
  const parts = [entry];
  for (const input of inputs) {
    if (input.type === "bool" || input.type === "boolean") {
      if (input.defaultValue === "true") parts.push(`--${input.name}`);
      continue;
    }
    if (input.type.endsWith("[]")) {
      const sample = input.defaultValue ?? `${input.name}_1 ${input.name}_2`;
      parts.push(`--${input.name} ${sample}`);
      continue;
    }
    const sample = input.defaultValue ?? `<${input.name}>`;
    const quoted = /\s/.test(sample) ? JSON.stringify(sample) : sample;
    parts.push(`--${input.name} ${quoted}`);
  }
  return parts.join(" \\\n  ");
}

function pythonScript(notebook: NotebookDoc, inputs: MarkerInput[], body: string, note: string): string {
  const lines = [
    "#!/usr/bin/env python3",
    `# 由笔记本 ${notebook.name} 生成，请勿手改`,
    "import argparse",
    "p = argparse.ArgumentParser()",
    ...inputs.map(argparseLine),
    "args = p.parse_args()",
    ...inputs.map((input) => `${input.name} = args.${input.name}`),
    "",
    note,
    body,
    "",
  ];
  return lines.join("\n");
}

function rScript(notebook: NotebookDoc, inputs: MarkerInput[], body: string, note: string): string {
  const defaults = inputs
    .filter((input) => input.defaultValue !== undefined)
    .map((input) => `if (is.null(opt[["${input.name}"]])) opt[["${input.name}"]] <- ${JSON.stringify(input.defaultValue)}`);
  const bindings = inputs.map((input) => `${input.name} <- opt[["${input.name}"]]`);
  return [
    "#!/usr/bin/env Rscript",
    `# 由笔记本 ${notebook.name} 生成，请勿手改`,
    "args <- commandArgs(trailingOnly = TRUE)",
    "opt <- list()",
    "i <- 1L",
    "while (i <= length(args)) {",
    "  key <- sub('^--', '', args[[i]])",
    "  if (i == length(args) || startsWith(args[[i + 1L]], '--')) { opt[[key]] <- TRUE; i <- i + 1L }",
    "  else { opt[[key]] <- args[[i + 1L]]; i <- i + 2L }",
    "}",
    ...defaults,
    ...bindings,
    "",
    note,
    body,
    "",
  ].join("\n");
}

export function convertNotebook(notebook: NotebookDoc, entryName?: string): ConvertedNotebook {
  const included: CellRef[] = [];
  const excluded: CellRef[] = [];
  notebook.cells.forEach((cell, index) => {
    const ref = { index: index + 1, id: cell.id, role: cell.role };
    if (includedRole(cell.role)) included.push(ref);
    else excluded.push(ref);
  });

  const inputs: MarkerInput[] = [];
  const outputs: MarkerOutput[] = [];
  for (const ref of included) {
    const cell = notebook.cells[ref.index - 1];
    const where = `单元格 [${ref.index}]`;
    for (const line of cell.source.split("\n")) {
      const input = INPUT_RE.exec(line);
      if (input) {
        const marker = parseInput(input[1], where);
        if (inputs.some((item) => item.name === marker.name)) throw new ConvertError(`${where}：重复的输入 ${marker.name}`);
        inputs.push(marker);
      }
      const output = OUTPUT_RE.exec(line);
      if (output) {
        const marker = parseOutput(output[1], where);
        if (outputs.some((item) => item.name === marker.name)) throw new ConvertError(`${where}：重复的输出 ${marker.name}`);
        outputs.push(marker);
      }
    }
  }

  const chunks = included
    .map((ref) => stripCell(notebook.cells[ref.index - 1].source, inputs))
    .filter(Boolean);
  const excludedNote = excluded.filter((ref) => ref.role === "explore").map((ref) => `[${ref.index}]`);
  const includedNote = included.map((ref) => `[${ref.index}]`).join("");
  const note = `# —— 单元格 ${includedNote || "（无）"}；${excludedNote.length ? `${excludedNote.join("")} 自由探索已排除` : "说明单元格已排除"} ——`;
  const language: NotebookLanguage = notebook.language;
  const ext = language === "r" ? "R" : "py";
  const entry = entryName ?? `bin/${slug(notebook.name)}.${ext}`;
  const script = language === "r" ? rScript(notebook, inputs, chunks.join("\n\n"), note) : pythonScript(notebook, inputs, chunks.join("\n\n"), note);
  return {
    language,
    entry,
    script,
    commandPreview: commandPreview(entry.split("/").pop() ?? entry, inputs),
    inputs,
    outputs,
    included,
    excluded,
  };
}

/** Argv for the generated CLI. Values for list inputs are comma- or whitespace-separated. */
export function tryRunArgv(inputs: MarkerInput[], values: Record<string, string>): string[] {
  const argv: string[] = [];
  for (const input of inputs) {
    const raw = values[input.name]?.trim() ?? "";
    if (!raw) {
      if (input.required && input.defaultValue === undefined && input.type !== "bool" && input.type !== "boolean") {
        throw new ConvertError(`缺少参数 ${input.name}`);
      }
      continue;
    }
    if (input.type === "bool" || input.type === "boolean") {
      if (raw === "true" || raw === "1") argv.push(`--${input.name}`);
      continue;
    }
    if (input.type.endsWith("[]")) {
      const items = raw.split(/[\s,]+/).filter(Boolean);
      if (!items.length) throw new ConvertError(`缺少参数 ${input.name}`);
      argv.push(`--${input.name}`, ...items);
      continue;
    }
    argv.push(`--${input.name}`, raw);
  }
  return argv;
}
