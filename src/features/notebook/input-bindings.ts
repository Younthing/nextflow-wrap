import { ConvertError, tryRunArgv } from "./convert";
import type { MarkerInput, TryRunInputBinding, TryRunInputSource } from "./types";

export type InputSource = TryRunInputSource;

/** One uploaded file. Content is standard base64, no data-URL prefix. */
export interface BindingFile {
  name: string;
  contentBase64: string;
}

/** Request body for one input port. */
export interface PortBindingRequest {
  port: string;
  source: InputSource;
  /** Path string, or the sample id when source is sample. */
  value?: string;
  files?: BindingFile[];
}

export interface InputDraft {
  source: InputSource;
  path: string;
  sampleId: string;
  files: BindingFile[];
}

export interface PlannedFile {
  name: string;
  bytes: Uint8Array;
}

/** A path binding whose tokens staging may copy into the work directory. */
export interface PlannedPath {
  port: string;
  list: boolean;
  raw: string;
  tokens: string[];
}

export interface InputPlan {
  values: Record<string, string>;
  lines: string[];
  records: TryRunInputBinding[];
  files: PlannedFile[];
  paths: PlannedPath[];
}

export interface PortSample {
  id: string;
  label: string;
  value: string;
  files: { name: string; text: string }[];
}

/** Per-file upload cap. The API rejects bodies over 2 MB, so the total stays under that. */
export const MAX_UPLOAD_BYTES = 1_000_000;
export const MAX_UPLOAD_TOTAL_BYTES = 1_200_000;
export const MAX_UPLOAD_FILES = 8;

const VALUE_TYPES = new Set(["int", "integer", "float", "number", "str", "string", "bool", "boolean"]);

const FASTQC_PAIR: PortSample = {
  id: "fastqc-pair",
  label: "内置样例：2 个 FastQC zip",
  value: "S1_fastq.zip,S2_fastq.zip",
  files: [
    { name: "S1_fastq.zip", text: "sample-s1" },
    { name: "S2_fastq.zip", text: "sample-s2" },
  ],
};

const SAMPLESHEET: PortSample = {
  id: "samplesheet",
  label: "内置样例：samplesheet.csv",
  value: "samplesheet.csv",
  files: [{ name: "samplesheet.csv", text: "sample,fastq_1\nS1,a.fq\n" }],
};

const COUNTS: PortSample = {
  id: "counts-tsv",
  label: "内置样例：counts.tsv",
  value: "counts.tsv",
  files: [{ name: "counts.tsv", text: "gene\tS1\tS2\nA\t10\t12\nB\t3\t4\n" }],
};

const DESIGN: PortSample = {
  id: "design-csv",
  label: "内置样例：design.csv",
  value: "design.csv",
  files: [{ name: "design.csv", text: "sample,condition\nS1,treated\nS2,control\n" }],
};


export const SOURCE_LABEL: Record<InputSource, string> = {
  upload: "上传",
  path: "路径",
  sample: "样例",
};

export function isFileInput(input: MarkerInput): boolean {
  return !VALUE_TYPES.has(input.type);
}

export function isListInput(input: MarkerInput): boolean {
  return input.type.endsWith("[]");
}

function tokensOf(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function hasToken(input: MarkerInput, words: readonly string[]): boolean {
  const tokens = new Set([...tokensOf(input.name), ...tokensOf(input.type)]);
  return words.some((word) => tokens.has(word));
}

/**
 * Sample fixtures keyed by port type and name.
 * A list whose name mentions fastq or zip gets the FastQC pair.
 * A single file whose name or type mentions samplesheet/csv, counts, or design gets that table.
 */
export function samplesForInput(input: MarkerInput): PortSample[] {
  if (!isFileInput(input)) return [];
  const list = isListInput(input);
  const name = input.name.toLowerCase();
  if (list && (name.includes("fastq") || name.includes("fastqc") || hasToken(input, ["zip"]))) return [FASTQC_PAIR];
  if (!list && (name.includes("samplesheet") || hasToken(input, ["samplesheet", "csv"]))) return [SAMPLESHEET];
  if (!list && hasToken(input, ["count", "counts"])) return [COUNTS];
  if (!list && hasToken(input, ["design"])) return [DESIGN];
  return [];
}

export function bindingLine(port: string, source: InputSource, label: string): string {
  return `输入 ${port} · ${SOURCE_LABEL[source]} · ${label}`;
}

export function bytesLabel(bytes: number): string {
  if (bytes % 1_000_000 === 0) return `${bytes / 1_000_000} MB`;
  if (bytes > 1_000_000) return `${Math.round(bytes / 100_000) / 10} MB`;
  if (bytes % 1000 === 0) return `${bytes / 1000} KB`;
  return `${bytes} 字节`;
}

export function sourceChoices(input: MarkerInput): { source: InputSource; disabled: boolean; reason?: string }[] {
  const file = isFileInput(input);
  const samples = samplesForInput(input);
  return [
    { source: "upload", disabled: !file, reason: file ? undefined : "取值端口不能上传文件" },
    { source: "path", disabled: false },
    { source: "sample", disabled: samples.length === 0, reason: samples.length ? undefined : "这个端口没有样例" },
  ];
}

export function defaultInputDraft(input: MarkerInput): InputDraft {
  const samples = samplesForInput(input);
  if (isFileInput(input) && samples[0]) {
    return { source: "sample", path: input.defaultValue ?? "", sampleId: samples[0].id, files: [] };
  }
  return { source: "path", path: input.defaultValue ?? "", sampleId: "", files: [] };
}

export function draftToBinding(input: MarkerInput, draft: InputDraft): PortBindingRequest {
  if (draft.source === "upload") return { port: input.name, source: "upload", files: draft.files };
  if (draft.source === "sample") return { port: input.name, source: "sample", value: draft.sampleId };
  return { port: input.name, source: "path", value: draft.path };
}

export function previewBinding(input: MarkerInput, draft: InputDraft): { ok: true; line: string } | { ok: false; message: string } {
  try {
    const plan = planTryRunInputs([input], [draftToBinding(input, draft)]);
    return { ok: true, line: plan.lines[0] ?? bindingLine(input.name, draft.source, "") };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "无法绑定" };
  }
}

/** Basename safe to write inside the try-run directory. */
export function safeUploadName(raw: string): string {
  const base = raw.split(/[/\\]/).pop()?.trim() ?? "";
  if (!base || base === "." || base === ".." || base.includes("\0")) throw new ConvertError("上传文件名无效");
  const cleaned = base
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .replace(/_+/g, "_")
    .replace(/^[_.]+|[_.]+$/g, "")
    .slice(0, 120);
  if (!cleaned || cleaned === "." || cleaned === "..") throw new ConvertError("上传文件名无效");
  return cleaned;
}

function textBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function decodeUpload(contentBase64: string, port: string): Uint8Array {
  const compact = contentBase64.replace(/\s/g, "");
  if (!compact) return new Uint8Array();
  let binary: string;
  try {
    binary = globalThis.atob(compact);
  } catch {
    throw new ConvertError(`端口 ${port} 的上传内容无效`);
  }
  if (binary.length > MAX_UPLOAD_BYTES) {
    throw new ConvertError(`端口 ${port} 的上传超过 ${bytesLabel(MAX_UPLOAD_BYTES)}`);
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function needsValue(input: MarkerInput): boolean {
  return input.required && input.defaultValue === undefined && input.type !== "bool" && input.type !== "boolean";
}

function listTokens(raw: string): string[] {
  return raw.split(/[\s,]+/).filter(Boolean);
}

interface ResolveResult {
  value: string;
  label: string;
}

function claim(used: Set<string>, name: string) {
  if (used.has(name)) throw new ConvertError(`试跑文件名冲突：${name}`);
  used.add(name);
}

function resolveOne(
  input: MarkerInput,
  request: PortBindingRequest,
  used: Set<string>,
  files: PlannedFile[],
  paths: PlannedPath[],
): ResolveResult {
  if (request.source === "upload") {
    if (!isFileInput(input)) throw new ConvertError(`端口 ${input.name} 不能上传文件`);
    const uploaded = request.files ?? [];
    if (!uploaded.length) {
      if (needsValue(input)) throw new ConvertError(`端口 ${input.name} 还没有上传文件`);
      return { value: "", label: "（未选择文件）" };
    }
    if (uploaded.length > MAX_UPLOAD_FILES) throw new ConvertError(`端口 ${input.name} 上传文件过多`);
    if (!isListInput(input) && uploaded.length > 1) throw new ConvertError(`端口 ${input.name} 只能上传一个文件`);
    const names: string[] = [];
    for (const file of uploaded) {
      const name = safeUploadName(file.name);
      claim(used, name);
      files.push({ name, bytes: decodeUpload(file.contentBase64 ?? "", input.name) });
      names.push(name);
    }
    const value = isListInput(input) ? names.join(",") : names[0] ?? "";
    return { value, label: names.join(", ") };
  }

  if (request.source === "sample") {
    if (!isFileInput(input)) throw new ConvertError(`端口 ${input.name} 不能使用样例文件`);
    const id = request.value?.trim() ?? "";
    const sample = samplesForInput(input).find((item) => item.id === id);
    if (!sample) throw new ConvertError(`端口 ${input.name} 没有样例${id ? ` ${id}` : ""}`);
    for (const file of sample.files) {
      claim(used, file.name);
      files.push({ name: file.name, bytes: textBytes(file.text) });
    }
    return { value: sample.value, label: sample.label };
  }

  const raw = request.value?.trim() ?? "";
  if (isFileInput(input) && raw) {
    const tokens = isListInput(input) ? listTokens(raw) : [raw];
    paths.push({ port: input.name, list: isListInput(input), raw, tokens });
  }
  return { value: raw, label: raw || "（空）" };
}

function clearerMissing(inputs: MarkerInput[], requests: Map<string, PortBindingRequest>, error: unknown): never {
  if (!(error instanceof ConvertError) || !error.message.startsWith("缺少参数 ")) throw error;
  const name = error.message.slice("缺少参数 ".length);
  const input = inputs.find((item) => item.name === name);
  const source = requests.get(name)?.source;
  if (source === "upload") throw new ConvertError(`端口 ${name} 还没有上传文件`);
  if (source === "sample") throw new ConvertError(`端口 ${name} 还没有选择样例`);
  if (input && isFileInput(input)) throw new ConvertError(`端口 ${name} 还没有填写路径`);
  throw error;
}

function planRequests(inputs: MarkerInput[], requests: PortBindingRequest[]): InputPlan {
  const byPort = new Map<string, PortBindingRequest>();
  for (const request of requests) {
    if (byPort.has(request.port)) throw new ConvertError(`重复绑定 ${request.port}`);
    if (!inputs.some((input) => input.name === request.port)) throw new ConvertError(`未知输入端口 ${request.port}`);
    byPort.set(request.port, request);
  }

  const used = new Set<string>();
  const files: PlannedFile[] = [];
  const paths: PlannedPath[] = [];
  const values: Record<string, string> = {};
  const records: TryRunInputBinding[] = [];
  const lines: string[] = [];

  for (const input of inputs) {
    const request = byPort.get(input.name) ?? { port: input.name, source: "path" as const, value: "" };
    const resolved = resolveOne(input, request, used, files, paths);
    if (resolved.value) values[input.name] = resolved.value;
    records.push({ port: input.name, source: request.source, label: resolved.label });
    lines.push(bindingLine(input.name, request.source, resolved.label));
  }

  const total = files.reduce((sum, file) => sum + file.bytes.byteLength, 0);
  if (total > MAX_UPLOAD_TOTAL_BYTES && requests.some((request) => request.source === "upload")) {
    throw new ConvertError(`上传合计超过 ${bytesLabel(MAX_UPLOAD_TOTAL_BYTES)}`);
  }

  try {
    tryRunArgv(inputs, values);
  } catch (error) {
    clearerMissing(inputs, byPort, error);
  }

  return { values, lines, records, files, paths };
}

/** Turn per-port bindings into CLI values and files to stage. An unbound port is an empty path. */
export function planTryRunInputs(inputs: MarkerInput[], bindings: PortBindingRequest[] = []): InputPlan {
  return planRequests(inputs, bindings);
}
