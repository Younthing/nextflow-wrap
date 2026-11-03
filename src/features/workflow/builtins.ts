import { CATALOG_BUILTINS } from "./catalog-builtins";
import { OPERATOR_MODULES } from "./operators";
import type { ModuleDef } from "./types";

export const SAMPLESHEET_ID = "builtin/samplesheet";
export const FILE_ID = "builtin/file";
export const FOLDER_ID = "builtin/folder";

/** Nodes that hold a path chosen on the canvas and become a pipeline param. */
export const isInputNode = (moduleId: string) => moduleId === FILE_ID || moduleId === FOLDER_ID;

/** Nodes that ship with the product: inputs that turn pipeline params into channels, operators and helpers. */
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
    origin: "builtin",
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
    id: FILE_ID,
    path: "",
    name: "文件输入",
    process: "FILE",
    category: "输入",
    description: "在节点上选一个文件，输出 [ [id:文件名], file ]。格式按扩展名识别。",
    keywords: ["input", "file", "path", "h5ad", "pdb", "sdf", "csv"],
    tools: [],
    origin: "builtin",
    builtin: true,
    inputs: [],
    outputs: [
      {
        name: "file",
        description: "[ [id:文件名], file ]",
        elements: [
          { name: "meta", type: "map", kind: "meta", description: "文件信息，id 是去掉扩展名的文件名" },
          { name: "file", type: "file", kind: "file", description: "选中的文件" },
        ],
      },
    ],
  },
  {
    id: FOLDER_ID,
    path: "",
    name: "文件夹输入",
    process: "FOLDER",
    category: "输入",
    description: "在节点上选一个文件夹，整个文件夹作为一个路径交给下游，输出 [ [id:文件夹名], dir ]。",
    keywords: ["input", "folder", "directory", "dir", "path"],
    tools: [],
    origin: "builtin",
    builtin: true,
    inputs: [],
    outputs: [
      {
        name: "dir",
        description: "[ [id:文件夹名], dir ]",
        elements: [
          { name: "meta", type: "map", kind: "meta", description: "文件夹信息，id 是文件夹名" },
          { name: "dir", type: "directory", kind: "file", description: "选中的文件夹", format: "dir" },
        ],
      },
    ],
  },
  ...CATALOG_BUILTINS,
  ...OPERATOR_MODULES,
];

const FORMAT_ALIASES: Record<string, string> = {
  fa: "fasta",
  fna: "fasta",
  fas: "fasta",
  fq: "fastq",
  gff: "gtf",
  gff3: "gtf",
  yml: "yaml",
  tif: "tiff",
  jpeg: "jpg",
  htm: "html",
};

/** File format from a path's extension: `pbmc.h5ad` → `h5ad`, `reads.fq.gz` → `fastq`. */
export function formatFromPath(path: string): string | undefined {
  const name = path.trim().replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? "";
  const parts = name.toLowerCase().split(".");
  if (parts.length < 2) return undefined;
  let ext = parts.pop()!;
  if ((ext === "gz" || ext === "bz2" || ext === "zip") && parts.length > 1) ext = parts.pop()!;
  if (!ext) return undefined;
  return FORMAT_ALIASES[ext] ?? ext;
}

/** The last segment of a path, for labels. */
export function pathName(path: string): string {
  return path.trim().replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? "";
}

/** A file input node's output port carries the format of the chosen file. */
export function withFileFormat(def: ModuleDef, path: string | undefined): ModuleDef {
  if (def.id !== FILE_ID) return def;
  const format = path ? formatFromPath(path) : undefined;
  if (!format) return def;
  return {
    ...def,
    outputs: def.outputs.map((port) => ({
      ...port,
      elements: port.elements.map((el) => (el.kind === "file" ? { ...el, format } : el)),
    })),
  };
}
