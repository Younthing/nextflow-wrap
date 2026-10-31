import { OPERATOR_MODULES } from "./operators";
import { TEST_MODULES } from "./test-modules";
import type { ModuleDef } from "./types";

export const SAMPLESHEET_ID = "builtin/samplesheet";
export const REFERENCE_ID = "builtin/reference";

export const REFERENCE_FORMATS = ["fasta", "gtf", "fai", "bed", "vcf", "index", "other"] as const;

/** Nodes that are not nf-core modules but turn pipeline params into channels. */
export const BUILTIN_MODULES: ModuleDef[] = [
  {
    id: SAMPLESHEET_ID,
    path: "",
    name: "样本表",
    process: "SAMPLESHEET",
    category: "输入",
    description:
      "读取 --input 指定的样本表（CSV），按 assets/schema_input.json 校验后，每个样本输出一组 [meta, reads]。",
    keywords: ["input", "samplesheet", "fastq"],
    tools: [],
    builtin: true,
    inputs: [],
    outputs: [
      {
        name: "reads",
        description: "每个样本的 meta 和 FastQ 文件",
        elements: [
          { name: "meta", type: "map", kind: "meta", description: "样本信息，如 [ id:'S1', single_end:false ]" },
          { name: "reads", type: "file", kind: "file", description: "FastQ 文件", format: "fastq" },
        ],
      },
    ],
  },
  {
    id: REFERENCE_ID,
    path: "",
    name: "参考文件",
    process: "REFERENCE",
    category: "输入",
    description:
      "把一个流程参数（如 --fasta）变成通道。同时提供带 meta 的 [meta, file] 和不带 meta 的 file 两种输出。",
    keywords: ["reference", "genome", "fasta", "gtf", "param"],
    tools: [],
    builtin: true,
    inputs: [],
    outputs: [
      {
        name: "with_meta",
        description: "[ [id:文件名], file ]",
        elements: [
          { name: "meta", type: "map", kind: "meta", description: "参考信息" },
          { name: "file", type: "file", kind: "file", description: "参考文件" },
        ],
      },
      {
        name: "file",
        description: "只有文件本身",
        elements: [{ name: "file", type: "file", kind: "file", description: "参考文件" }],
      },
    ],
  },
  ...OPERATOR_MODULES,
  ...TEST_MODULES,
];

/** Applies a reference node's chosen format to its output ports. */
export function withReferenceFormat(def: ModuleDef, format: string | undefined): ModuleDef {
  if (def.id !== REFERENCE_ID || !format || format === "other") return def;
  return {
    ...def,
    outputs: def.outputs.map((port) => ({
      ...port,
      elements: port.elements.map((el) => (el.kind === "file" ? { ...el, format } : el)),
    })),
  };
}
