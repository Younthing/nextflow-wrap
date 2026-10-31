import type { ChannelElement, ModuleDef, PortDef, WidgetValue } from "./types";

/**
 * Channel operators and input sources. An edge only says which channel feeds
 * which input. Anything that changes alignment or cardinality is one of these
 * nodes. Keys are `meta.id`: one record per key is `join`, one key to many
 * records is `combine(by: 0)`.
 */

export const CREATE_KEY_ID = "builtin/create-key";
export const COMBINE_ID = "builtin/combine";
export const JOIN_ID = "builtin/join";
export const COLLECT_ID = "builtin/collect";
export const GROUP_ID = "builtin/group";
export const COLLECT_FILE_ID = "builtin/collect-file";
export const FLATTEN_ID = "builtin/flatten";
export const SPLIT_TEXT_ID = "builtin/split-text";
export const BUFFER_ID = "builtin/buffer";
export const CSV_ID = "builtin/csv";
export const FILE_PAIRS_ID = "builtin/file-pairs";
export const FILE_PATH_ID = "builtin/file-path";
export const FILE_RANGE_ID = "builtin/file-range";

const OPERATOR_LIST = [
  CREATE_KEY_ID,
  COMBINE_ID,
  JOIN_ID,
  COLLECT_ID,
  GROUP_ID,
  COLLECT_FILE_ID,
  FLATTEN_ID,
  SPLIT_TEXT_ID,
  BUFFER_ID,
  CSV_ID,
  FILE_PAIRS_ID,
  FILE_PATH_ID,
  FILE_RANGE_ID,
] as const;

export const OPERATOR_IDS = new Set<string>(OPERATOR_LIST);

export const isOperator = (id: string) => OPERATOR_IDS.has(id);

const meta = (description = "对齐键是 meta.id"): ChannelElement => ({
  name: "meta",
  type: "map",
  kind: "meta",
  description,
});

const file = (name: string, description: string): ChannelElement => ({
  name,
  type: "file",
  kind: "file",
  description,
});

const port = (name: string, description: string, elements: ChannelElement[]): PortDef => ({
  name,
  description,
  elements,
});

const metaFile = (name: string, description: string) => port(name, description, [meta(), file("file", description)]);
const bare = (name: string, description: string) => port(name, description, [file("file", description)]);

function operator(spec: Pick<ModuleDef, "id" | "name" | "process" | "description" | "keywords" | "inputs" | "outputs">): ModuleDef {
  return {
    path: "",
    category: "通道",
    tools: [],
    builtin: true,
    ...spec,
  };
}

export const OPERATOR_MODULES: ModuleDef[] = [
  operator({
    id: CREATE_KEY_ID,
    name: "提取键",
    process: "CREATE_KEY",
    description: "从文件名抽出一段作为 meta.id，供 join / combine 按键对齐。",
    keywords: ["key", "map", "combine", "group"],
    inputs: [bare("item", "文件，或去掉 meta 之后的文件")],
    outputs: [metaFile("keyed", "带 meta.id 的文件")],
  }),
  operator({
    id: COMBINE_ID,
    name: "按键组合",
    process: "COMBINE_KEY",
    description: "一个键对应多条记录时，用 combine(by: 0) 按 meta.id 对齐左右通道。",
    keywords: ["combine", "key", "one-to-many"],
    inputs: [metaFile("left", "左通道"), metaFile("right", "右通道")],
    outputs: [metaFile("left", "对齐后的左通道"), metaFile("right", "对齐后的右通道")],
  }),
  operator({
    id: JOIN_ID,
    name: "按键连接",
    process: "JOIN_KEY",
    description: "一个键对应一条记录时，用 join 按 meta.id 对齐左右通道。",
    keywords: ["join", "key", "one-to-one"],
    inputs: [metaFile("left", "左通道"), metaFile("right", "右通道")],
    outputs: [metaFile("left", "对齐后的左通道"), metaFile("right", "对齐后的右通道")],
  }),
  operator({
    id: COLLECT_ID,
    name: "全部收集",
    process: "COLLECT",
    description: "把上游所有输出收成一份，下游只跑一次。",
    keywords: ["collect"],
    inputs: [bare("items", "要收集的文件")],
    outputs: [bare("collected", "全部文件组成的一个列表")],
  }),
  operator({
    id: GROUP_ID,
    name: "按键分组",
    process: "GROUP",
    description: "把 meta.id 相同的文件分成一组（groupTuple）。",
    keywords: ["groupTuple", "batch"],
    inputs: [metaFile("items", "带键的文件")],
    outputs: [metaFile("grouped", "同一键下的文件列表")],
  }),
  operator({
    id: COLLECT_FILE_ID,
    name: "收集到文件",
    process: "COLLECT_FILE",
    description: "用 collectFile 把上游文件拼成一个文件。",
    keywords: ["collectFile"],
    inputs: [bare("items", "要拼接的文件")],
    outputs: [bare("file", "拼好的单个文件")],
  }),
  operator({
    id: FLATTEN_ID,
    name: "拆成单文件",
    process: "FLATTEN",
    description: "上游一次产出多个文件时，用 flatten 让下游每个文件跑一次。",
    keywords: ["flatten"],
    inputs: [bare("items", "一次任务产出的多个文件")],
    outputs: [bare("file", "单个文件")],
  }),
  operator({
    id: SPLIT_TEXT_ID,
    name: "按块拆分",
    process: "SPLIT_TEXT",
    description: "用 splitText 把文件切成固定行数的块。默认写成文件，避免整块留在内存里。",
    keywords: ["splitText", "chunk"],
    inputs: [bare("file", "要拆分的文本文件")],
    outputs: [bare("chunk", "一个文本块")],
  }),
  operator({
    id: BUFFER_ID,
    name: "任务分批",
    process: "BUFFER",
    description: "用 buffer 把许多小任务收成一批，减少提交次数。",
    keywords: ["buffer", "batch"],
    inputs: [bare("items", "逐个文件")],
    outputs: [bare("batch", "一批文件")],
  }),
  operator({
    id: CSV_ID,
    name: "CSV 记录",
    process: "CSV_RECORDS",
    description: "用 splitCsv 读取 CSV，每一行启动一次下游任务。",
    keywords: ["csv", "splitCsv"],
    inputs: [],
    outputs: [
      port("records", "每行一个 [meta, read1, read2]", [
        meta(),
        file("read1", "第一列文件"),
        file("read2", "第二列文件"),
      ]),
    ],
  }),
  operator({
    id: FILE_PAIRS_ID,
    name: "文件配对",
    process: "FILE_PAIRS",
    description: "用 fromFilePairs 按文件名把配对文件收成一组，键写入 meta.id。",
    keywords: ["fromFilePairs", "pairs"],
    inputs: [],
    outputs: [metaFile("pairs", "配对文件，meta.id 是共同前缀")],
  }),
  operator({
    id: FILE_PATH_ID,
    name: "文件路径",
    process: "FILE_PATH",
    description: "用 fromPath 让每个匹配 glob 的文件各跑一次。",
    keywords: ["fromPath", "glob"],
    inputs: [],
    outputs: [bare("files", "匹配到的文件")],
  }),
  operator({
    id: FILE_RANGE_ID,
    name: "文件范围",
    process: "FILE_RANGE",
    description: "用 Channel.from 在一段序号上展开，并为每个序号配上文件。",
    keywords: ["range", "from"],
    inputs: [],
    outputs: [
      port("range", "每个序号一个 [meta, left, right]", [
        meta(),
        file("left", "第一个文件"),
        file("right", "第二个文件"),
      ]),
    ],
  }),
];

export interface OperatorField {
  key: string;
  label: string;
  type: "string" | "number" | "boolean";
  hint?: string;
}

interface Field extends OperatorField {
  default: WidgetValue;
}

const FIELDS: Record<string, Field[]> = {
  [CREATE_KEY_ID]: [
    { key: "separator", label: "分隔符", type: "string", default: "_", hint: "按这个符号切开文件名" },
    { key: "index", label: "片段序号", type: "number", default: 0, hint: "从 0 开始" },
    { key: "separator2", label: "第二分隔符", type: "string", default: "", hint: "留空则只切一次" },
    { key: "index2", label: "第二片段序号", type: "number", default: 0 },
  ],
  [COLLECT_FILE_ID]: [{ key: "name", label: "文件名", type: "string", default: "collected.txt" }],
  [SPLIT_TEXT_ID]: [
    { key: "size", label: "每块行数", type: "number", default: 5 },
    { key: "file", label: "写成文件", type: "boolean", default: true, hint: "大文件不要留在内存里" },
  ],
  [BUFFER_ID]: [{ key: "size", label: "每批数量", type: "number", default: 10 }],
  [CSV_ID]: [
    { key: "param", label: "参数名", type: "string", default: "index", hint: "对应 --参数，指向 CSV 文件" },
    { key: "glob", label: "直接路径", type: "string", default: "", hint: "写了就不用参数" },
    { key: "id", label: "样本列", type: "string", default: "sampleId" },
    { key: "read1", label: "文件列 1", type: "string", default: "read1" },
    { key: "read2", label: "文件列 2", type: "string", default: "read2" },
  ],
  [FILE_PAIRS_ID]: [
    { key: "param", label: "参数名", type: "string", default: "reads" },
    { key: "glob", label: "glob", type: "string", default: "", hint: "例如 data/*_{1,2}.fq.gz" },
    { key: "check", label: "文件必须存在", type: "boolean", default: true },
    { key: "grouping", label: "分组表达式", type: "string", default: "", hint: "例如 file -> file.name.replaceAll(/.bam|.bai$/, '')" },
  ],
  [FILE_PATH_ID]: [
    { key: "param", label: "参数名", type: "string", default: "files" },
    { key: "glob", label: "glob", type: "string", default: "" },
    { key: "check", label: "文件必须存在", type: "boolean", default: true },
  ],
  [FILE_RANGE_ID]: [
    { key: "start", label: "起始", type: "number", default: 1 },
    { key: "end", label: "结束", type: "number", default: 2 },
    { key: "prefix", label: "样本前缀", type: "string", default: "sample" },
    { key: "left", label: "左文件模板", type: "string", default: "/data/foo.{n}.indels.vcf", hint: "{n} 会换成序号" },
    { key: "right", label: "右文件模板", type: "string", default: "/data/foo.snvs.{n}.vcf" },
  ],
};

export function operatorFields(moduleId: string): OperatorField[] | null {
  const fields = FIELDS[moduleId];
  if (!fields) return null;
  return fields.map(({ key, label, type, hint }) => ({ key, label, type, hint }));
}

export function operatorDefaults(moduleId: string): Record<string, WidgetValue> | undefined {
  const fields = FIELDS[moduleId];
  if (!fields) return undefined;
  return Object.fromEntries(fields.map((field) => [field.key, field.default]));
}

/** One output uses `ch_alias`; several outputs use `ch_alias_<port>`. */
export function operatorChannel(alias: string, port: string, outputCount: number): string {
  const base = `ch_${alias.toLowerCase()}`;
  return outputCount === 1 ? base : `${base}_${port}`;
}

/** Param a source node reads, when it is not given a literal glob. */
export function declaredParam(
  moduleId: string,
  settings: Record<string, WidgetValue> | undefined,
): { name: string; file: boolean } | null {
  if (moduleId !== CSV_ID && moduleId !== FILE_PAIRS_ID && moduleId !== FILE_PATH_ID) return null;
  if (String(settings?.glob ?? "").trim()) return null;
  const fallback = moduleId === CSV_ID ? "index" : moduleId === FILE_PAIRS_ID ? "reads" : "files";
  const name = String(settings?.param ?? fallback).trim();
  if (!name) return null;
  return { name, file: moduleId === CSV_ID };
}
