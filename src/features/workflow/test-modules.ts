import type { ChannelElement, ModuleDef, PortDef, WorkflowNode } from "./types";

/**
 * Temporary host-command processes for exercising canvas patterns on this
 * machine. They are written inline into main.nf, never into modules/.
 */
const NOTE = "临时测试模块，只用于验证通道模式。";

const meta = (): ChannelElement => ({ name: "meta", type: "map", kind: "meta", description: "meta.id" });
const file = (name: string): ChannelElement => ({ name, type: "file", kind: "file", description: name });
const value = (name: string): ChannelElement => ({ name, type: "string", kind: "value", description: name });

const tuple = (name: string, elements: ChannelElement[]): PortDef => ({ name, description: NOTE, elements });
const widget = (name: string, kind: "integer" | "string"): PortDef => ({
  name,
  description: NOTE,
  widget: kind === "integer" ? "integer" : "string",
  elements: [value(name)],
});

const metaFile = (name: string) => tuple(name, [meta(), file("infile")]);
const metaOut = tuple("result", [meta(), file("result")]);
const bareIn = tuple("input", [file("infile")]);
const bareOut = tuple("result", [file("result")]);

function testModule(spec: Pick<ModuleDef, "id" | "process" | "name" | "description" | "inputs" | "outputs">): ModuleDef {
  return {
    path: "",
    category: "临时测试",
    keywords: ["temporary", "test", "host"],
    tools: [],
    builtin: true,
    temporary: true,
    ...spec,
    description: `${NOTE} ${spec.description}`,
  };
}

export const TEST_CAT_ID = "builtin/test/cat";
export const TEST_CAT_PAIR_ID = "builtin/test/cat-pair";
export const TEST_SORT_ID = "builtin/test/sort";
export const TEST_UNIQ_ID = "builtin/test/uniq";
export const TEST_HEAD_ID = "builtin/test/head";
export const TEST_TAIL_ID = "builtin/test/tail";
export const TEST_CUT_ID = "builtin/test/cut";
export const TEST_TR_ID = "builtin/test/tr";
export const TEST_GREP_ID = "builtin/test/grep";
export const TEST_AWK_ID = "builtin/test/awk";
export const TEST_PASTE_ID = "builtin/test/paste";
export const TEST_WC_ID = "builtin/test/wc";
export const TEST_SPLIT_ID = "builtin/test/split";
export const TEST_TEE_ID = "builtin/test/tee";
export const TEST_CAT_FILES_ID = "builtin/test/cat-files";
export const TEST_SORT_FILES_ID = "builtin/test/sort-files";
export const TEST_WC_FILES_ID = "builtin/test/wc-files";
export const TEST_TEE_FILES_ID = "builtin/test/tee-files";
export const TEST_TR_FILES_ID = "builtin/test/tr-files";
export const TEST_GREP_FILES_ID = "builtin/test/grep-files";
export const TEST_CUT_FILES_ID = "builtin/test/cut-files";
export const TEST_AWK_FILES_ID = "builtin/test/awk-files";
export const TEST_SPLIT_FILES_ID = "builtin/test/split-files";

export const TEST_MODULES: ModuleDef[] = [
  testModule({
    id: TEST_CAT_ID,
    process: "TEST_CAT",
    name: "cat",
    description: "用 cat 把一组文件按样本拼成一个文件。",
    inputs: [metaFile("input")],
    outputs: [metaOut],
  }),
  testModule({
    id: TEST_CAT_PAIR_ID,
    process: "TEST_CAT_PAIR",
    name: "cat pair",
    description: "用 cat 把元组里的两个文件接在一起。",
    inputs: [tuple("pair", [meta(), file("left"), file("right")])],
    outputs: [metaOut],
  }),
  testModule({
    id: TEST_SORT_ID,
    process: "TEST_SORT",
    name: "sort",
    description: "用 sort 按行排序。",
    inputs: [metaFile("input")],
    outputs: [metaOut],
  }),
  testModule({
    id: TEST_UNIQ_ID,
    process: "TEST_UNIQ",
    name: "uniq",
    description: "用 uniq 去掉相邻重复行。",
    inputs: [metaFile("input")],
    outputs: [metaOut],
  }),
  testModule({
    id: TEST_HEAD_ID,
    process: "TEST_HEAD",
    name: "head",
    description: "用 head 取文件开头几行。",
    inputs: [metaFile("input"), widget("lines", "integer")],
    outputs: [metaOut],
  }),
  testModule({
    id: TEST_TAIL_ID,
    process: "TEST_TAIL",
    name: "tail",
    description: "用 tail 取文件结尾几行。",
    inputs: [metaFile("input"), widget("lines", "integer")],
    outputs: [metaOut],
  }),
  testModule({
    id: TEST_PASTE_ID,
    process: "TEST_PASTE",
    name: "paste",
    description: "用 paste 把左右两个文件按行并在一起。",
    inputs: [
      tuple("left", [meta(), file("left")]),
      tuple("right", [{ ...meta(), name: "meta2" }, file("right")]),
    ],
    outputs: [metaOut],
  }),
  testModule({
    id: TEST_GREP_ID,
    process: "TEST_GREP",
    name: "grep",
    description: "用 grep -F 过滤行。第二个文件输入可以不连。",
    inputs: [metaFile("input"), widget("pattern", "string"), tuple("patterns", [file("patterns")])],
    outputs: [metaOut],
  }),
  testModule({
    id: TEST_CAT_FILES_ID,
    process: "TEST_CAT_FILES",
    name: "cat files",
    description: "用 cat 拼接不含 meta 的文件列表。",
    inputs: [bareIn],
    outputs: [bareOut],
  }),
  testModule({
    id: TEST_SORT_FILES_ID,
    process: "TEST_SORT_FILES",
    name: "sort files",
    description: "用 sort 排序不含 meta 的文件。",
    inputs: [bareIn],
    outputs: [bareOut],
  }),
  testModule({
    id: TEST_CUT_FILES_ID,
    process: "TEST_CUT_FILES",
    name: "cut",
    description: "用 cut -f 取制表符字段。",
    inputs: [bareIn, widget("fields", "integer")],
    outputs: [bareOut, tuple("notes", [file("notes")])],
  }),
  testModule({
    id: TEST_AWK_FILES_ID,
    process: "TEST_AWK_FILES",
    name: "awk",
    description: "用 awk 打印第三列。",
    inputs: [bareIn],
    outputs: [bareOut],
  }),
  testModule({
    id: TEST_WC_ID,
    process: "TEST_WC",
    name: "wc",
    description: "用 wc -l 统计行数。",
    inputs: [metaFile("input")],
    outputs: [metaOut],
  }),
  testModule({
    id: TEST_WC_FILES_ID,
    process: "TEST_WC_FILES",
    name: "wc files",
    description: "用 wc -l 统计单个文件的行数。",
    inputs: [bareIn],
    outputs: [bareOut],
  }),
  testModule({
    id: TEST_TR_FILES_ID,
    process: "TEST_TR_FILES",
    name: "tr",
    description: "用 tr 把小写字母换成大写。",
    inputs: [bareIn],
    outputs: [bareOut],
  }),
  testModule({
    id: TEST_GREP_FILES_ID,
    process: "TEST_GREP_FILES",
    name: "grep files",
    description: "用 grep -F 过滤一个文件。可选模式文件不连时得到空列表。",
    inputs: [bareIn, widget("pattern", "string"), tuple("patterns", [file("patterns")])],
    outputs: [bareOut],
  }),
  testModule({
    id: TEST_SPLIT_FILES_ID,
    process: "TEST_SPLIT_FILES",
    name: "split",
    description: "用 split 按行把文件切成多块。",
    inputs: [bareIn, widget("lines", "integer")],
    outputs: [tuple("parts", [file("parts")])],
  }),
  testModule({
    id: TEST_TEE_FILES_ID,
    process: "TEST_TEE_FILES",
    name: "tee",
    description: "用 tee 复制一份输出，可选的 side 文件故意不创建。",
    inputs: [bareIn],
    outputs: [bareOut, tuple("side", [file("side")])],
  }),
];

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function inputDecl(port: PortDef): string {
  if (port.widget) return `val ${port.name}`;
  if (port.elements.length === 1 && port.elements[0].kind === "file") {
    return `path ${port.elements[0].name}, stageAs: 'in?*'`;
  }
  const parts = port.elements.map((el, index) => {
    if (el.kind === "meta") return `val(${IDENT.test(el.name) ? el.name : index === 0 ? "meta" : "meta2"})`;
    if (el.kind === "value") return `val(${el.name})`;
    return `path(${el.name}, stageAs: '${el.name}?*')`;
  });
  return `tuple ${parts.join(", ")}`;
}

function outputDecl(port: PortDef, optional: boolean): string {
  const opt = optional ? ", optional: true" : "";
  const emit = IDENT.test(port.name) ? port.name : "result";
  if (port.name === "notes") return `path "notes.log", emit: notes${opt}`;
  if (port.name === "parts") return `path "chunk_*", emit: ${emit}${opt}`;
  if (port.name === "side") return `path "side.txt", emit: ${emit}${opt}`;
  if (port.elements.length === 1 && port.elements[0].kind === "file") return `path "out.txt", emit: ${emit}${opt}`;
  if (port.elements.some((el) => el.kind === "meta")) return `tuple val(meta), path("out.txt"), emit: ${emit}${opt}`;
  return `path "out.txt", emit: ${emit}${opt}`;
}

function command(id: string, node: WorkflowNode): string {
  const strict = node.data.settings?.strict === true;
  switch (id) {
    case TEST_CAT_ID:
    case TEST_CAT_FILES_ID:
      return 'cat $infile > out.txt';
    case TEST_CAT_PAIR_ID:
      return 'cat "$left" "$right" > out.txt';
    case TEST_SORT_ID:
    case TEST_SORT_FILES_ID:
      return 'sort $infile > out.txt';
    case TEST_UNIQ_ID:
      return 'uniq "$infile" > out.txt';
    case TEST_HEAD_ID:
      return 'head -n ${lines} "$infile" > out.txt';
    case TEST_TAIL_ID:
      return 'tail -n ${lines} "$infile" > out.txt';
    case TEST_CUT_ID:
    case TEST_CUT_FILES_ID:
      return 'cut -f ${fields} "$infile" > out.txt\necho colors > notes.log';
    case TEST_TR_ID:
    case TEST_TR_FILES_ID:
      return 'tr \'a-z\' \'A-Z\' < "$infile" > out.txt';
    case TEST_GREP_ID:
    case TEST_GREP_FILES_ID:
      return strict
        ? 'grep -F "${pattern}" "$infile" > out.txt'
        : 'grep -F "${pattern}" "$infile" > out.txt || true';
    case TEST_AWK_ID:
    case TEST_AWK_FILES_ID:
      return 'awk \'{print \\$3}\' "$infile" > out.txt';
    case TEST_PASTE_ID:
      return 'paste "$left" "$right" > out.txt';
    case TEST_WC_ID:
    case TEST_WC_FILES_ID:
      return 'wc -l < "$infile" | awk \'{print \\$1}\' > out.txt';
    case TEST_SPLIT_ID:
    case TEST_SPLIT_FILES_ID:
      return 'split -l ${lines} -d -a 2 "$infile" chunk_';
    case TEST_TEE_ID:
    case TEST_TEE_FILES_ID:
      return 'tee out.txt < "$infile" >/dev/null';
    default:
      return 'cat "$infile" > result.txt';
  }
}

/** Top-level process definitions. The comment marks them as temporary. */
export function renderTemporaryProcesses(nodes: { node: WorkflowNode; def: ModuleDef }[]): string {
  const blocks = nodes
    .filter((planned) => planned.def.temporary)
    .map(({ node, def }) => {
      const optional = new Set(
        String(node.data.config.optionalOutputs ?? "")
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean),
      );
      const inputs = def.inputs.map(inputDecl);
      const outputs = def.outputs.map((port) => outputDecl(port, optional.has(port.name) || port.name === "side"));
      return `// TEMPORARY TEST MODULE: ${node.data.alias} (${def.id})
process ${node.data.alias} {
    input:
    ${inputs.join("\n    ")}
    output:
    ${outputs.join("\n    ")}
    script:
    """
    ${command(def.id, node)}
    """
}`;
    });
  return blocks.join("\n\n");
}
