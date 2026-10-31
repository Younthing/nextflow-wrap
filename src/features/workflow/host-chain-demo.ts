import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { SAMPLESHEET_ID } from "./builtins";
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
} from "./operators";
import {
  TEST_AWK_FILES_ID,
  TEST_CAT_FILES_ID,
  TEST_CAT_ID,
  TEST_CAT_PAIR_ID,
  TEST_CUT_FILES_ID,
  TEST_GREP_FILES_ID,
  TEST_HEAD_ID,
  TEST_PASTE_ID,
  TEST_SORT_FILES_ID,
  TEST_SORT_ID,
  TEST_SPLIT_FILES_ID,
  TEST_TAIL_ID,
  TEST_TEE_FILES_ID,
  TEST_TR_FILES_ID,
  TEST_UNIQ_ID,
  TEST_WC_FILES_ID,
  TEST_WC_ID,
} from "./test-modules";
import type { WorkflowDoc, WorkflowEdge, WorkflowNode, WorkflowNodeData } from "./types";

function node(
  id: string,
  moduleId: string,
  alias: string,
  x: number,
  y: number,
  data: Partial<WorkflowNodeData> = {},
): WorkflowNode {
  return {
    id,
    position: { x, y },
    data: { moduleId, alias, widgets: {}, config: {}, ...data },
  };
}

/**
 * One canvas that chains the temporary host commands through the channel
 * patterns. `dir` is a directory of tiny text files on the runner host.
 */
export function hostChainWorkflow(dir: string, input = "samplesheet.csv"): WorkflowDoc {
  let edgeCount = 0;
  const edge = (source: string, sourcePort: string, target: string, targetPort: string): WorkflowEdge => {
    edgeCount += 1;
    return { id: `h${edgeCount}`, source, target, sourceHandle: `out:${sourcePort}`, targetHandle: `in:${targetPort}` };
  };
  const nodes: WorkflowNode[] = [
    node("samples", SAMPLESHEET_ID, "SAMPLESHEET", 0, 0),
    node("files", FILE_PATH_ID, "FILES", 320, 0, { settings: { glob: `${dir}/*_{1,2}.txt` } }),
    node("keys", CREATE_KEY_ID, "KEYS", 640, 0, { settings: { separator: "_", index: 0 } }),
    node("groups", GROUP_ID, "GROUPS", 960, 0),
    node("cat", TEST_CAT_ID, "CAT", 1280, 0),
    node("sort", TEST_SORT_ID, "SORT", 1600, 0, {
      config: { label: "process_single", publishPath: "${params.outdir}/sorted/${meta.id}" },
    }),
    node("uniq", TEST_UNIQ_ID, "UNIQ", 1920, 0),
    node("head", TEST_HEAD_ID, "HEAD", 2240, -160, { widgets: { lines: 1 } }),
    node("tail", TEST_TAIL_ID, "TAIL", 2240, 160, { widgets: { lines: 1 } }),
    node("join", JOIN_ID, "JOINED", 2560, 0),
    node("paste", TEST_PASTE_ID, "PASTE", 2880, 0),
    node("extras", FILE_PATH_ID, "EXTRAS", 320, 280, { settings: { glob: `${dir}/extra_*.txt` } }),
    node("extraKeys", CREATE_KEY_ID, "EXTRA_KEYS", 640, 280, { settings: { separator: "_", index: 1 } }),
    node("combine", COMBINE_ID, "COMBINED", 3200, 0),
    node("pasteExtra", TEST_PASTE_ID, "PASTE_EXTRA", 3520, 0),
    node("collect", COLLECT_ID, "COLLECTED", 3840, 0),
    node("catAll", TEST_CAT_FILES_ID, "CAT_ALL", 4160, 0),
    node("sorted", TEST_SORT_FILES_ID, "SORTED", 4480, 0),
    node("cut", TEST_CUT_FILES_ID, "CUT", 4800, -280, {
      widgets: { fields: 3 },
      config: { publishDirs: [{ path: "${params.outdir}/logs", pattern: "*.log" }] },
    }),
    node("awk", TEST_AWK_FILES_ID, "AWK", 4800, 40, { config: { publishPath: "${params.outdir}/awk" } }),
    node("colors", TEST_SORT_FILES_ID, "COLORS", 5120, -280, {
      config: {
        publishPath: "${params.outdir}/text",
        publishSaveAs: 'filename -> "colors_$filename"',
      },
    }),
    node("grep", TEST_GREP_FILES_ID, "GREP", 4800, 280, {
      widgets: { pattern: "apple" },
      config: { publishPath: "${params.outdir}/matched" },
    }),
    node("grepFail", TEST_GREP_FILES_ID, "GREP_FAIL", 5120, 280, {
      widgets: { pattern: "zzzz" },
      settings: { strict: true },
      config: { errorStrategy: "ignore" },
    }),
    node("upper", TEST_TR_FILES_ID, "UPPER", 5440, -480, {
      config: { when: "true", publishPath: "${params.outdir}/upper" },
    }),
    node("upperOff", TEST_TR_FILES_ID, "UPPER_OFF", 5440, -280, { config: { when: "false" } }),
    node("tee", TEST_TEE_FILES_ID, "TEE", 5440, -80, { config: { optionalOutputs: "side" } }),
    node("side", COLLECT_ID, "SIDE", 5760, -80),
    node("splitCmd", TEST_SPLIT_FILES_ID, "SPLIT_CMD", 5440, 120, { widgets: { lines: 1 } }),
    node("flat", FLATTEN_ID, "FLAT", 5760, 120),
    node("buffer", BUFFER_ID, "BATCH", 6080, 120, { settings: { size: 2 } }),
    node("batchCat", TEST_CAT_FILES_ID, "BATCH_CAT", 6400, 120),
    node("batchCollect", COLLECT_ID, "BATCH_COLLECT", 6720, 120),
    node("batchJoin", TEST_CAT_FILES_ID, "BATCH_JOIN", 7040, 120),
    node("batchSort", TEST_SORT_FILES_ID, "BATCH_SORT", 7360, 120, { config: { publishPath: "${params.outdir}/batches" } }),
    node("chunks", SPLIT_TEXT_ID, "CHUNKS", 5440, 360, { settings: { size: 1, file: true } }),
    node("wcChunk", TEST_WC_FILES_ID, "WC_CHUNK", 5760, 360),
    node("countFile", COLLECT_FILE_ID, "COUNT_FILE", 6080, 360, { settings: { name: "counts.txt" } }),
    node("teeCounts", TEST_TEE_FILES_ID, "TEE_COUNTS", 6400, 360, { config: { publishPath: "${params.outdir}/chunks" } }),
    node("wc", TEST_WC_FILES_ID, "WC", 5440, 560, {
      config: { memory: "1.GB", publishPath: "${params.outdir}/count" },
    }),
    node("pairs", FILE_PAIRS_ID, "PAIRS", 320, 560, { settings: { glob: `${dir}/*_{1,2}.txt` } }),
    node("catPairs", TEST_CAT_ID, "CAT_PAIRS", 640, 560),
    node("sortPairs", TEST_SORT_ID, "SORT_PAIRS", 960, 560, { config: { publishPath: "${params.outdir}/pairs/${meta.id}" } }),
    node("table", CSV_ID, "TABLE", 320, 840, {
      settings: { glob: `${dir}/table.csv`, id: "sampleId", read1: "read1", read2: "read2" },
    }),
    node("catTable", TEST_CAT_PAIR_ID, "CAT_TABLE", 640, 840, { config: { publishPath: "${params.outdir}/csv/${meta.id}" } }),
    node("wcTable", TEST_WC_ID, "WC_TABLE", 960, 840, { config: { publishPath: "${params.outdir}/csv-count/${meta.id}" } }),
    node("span", FILE_RANGE_ID, "SPAN", 320, 1120, {
      settings: {
        start: 1,
        end: 2,
        prefix: "sample",
        left: `${dir}/span/n.{n}.txt`,
        right: `${dir}/span/m.{n}.txt`,
      },
    }),
    node("catSpan", TEST_CAT_PAIR_ID, "CAT_SPAN", 640, 1120, { config: { publishPath: "${params.outdir}/range/${meta.id}" } }),
  ];
  const edges: WorkflowEdge[] = [
    edge("files", "files", "keys", "item"),
    edge("keys", "keyed", "groups", "items"),
    edge("groups", "grouped", "cat", "input"),
    edge("cat", "result", "sort", "input"),
    edge("sort", "result", "uniq", "input"),
    edge("uniq", "result", "head", "input"),
    edge("uniq", "result", "tail", "input"),
    edge("head", "result", "join", "left"),
    edge("tail", "result", "join", "right"),
    edge("join", "left", "paste", "left"),
    edge("join", "right", "paste", "right"),
    edge("extras", "files", "extraKeys", "item"),
    edge("extraKeys", "keyed", "combine", "right"),
    edge("paste", "result", "combine", "left"),
    edge("combine", "left", "pasteExtra", "left"),
    edge("combine", "right", "pasteExtra", "right"),
    edge("pasteExtra", "result", "collect", "items"),
    edge("collect", "collected", "catAll", "input"),
    edge("catAll", "result", "sorted", "input"),
    edge("sorted", "result", "cut", "input"),
    edge("sorted", "result", "awk", "input"),
    edge("cut", "result", "colors", "input"),
    edge("sorted", "result", "grep", "input"),
    edge("sorted", "result", "grepFail", "input"),
    edge("colors", "result", "upper", "input"),
    edge("colors", "result", "upperOff", "input"),
    edge("colors", "result", "tee", "input"),
    edge("tee", "side", "side", "items"),
    edge("colors", "result", "splitCmd", "input"),
    edge("splitCmd", "parts", "flat", "items"),
    edge("flat", "file", "buffer", "items"),
    edge("buffer", "batch", "batchCat", "input"),
    edge("batchCat", "result", "batchCollect", "items"),
    edge("batchCollect", "collected", "batchJoin", "input"),
    edge("batchJoin", "result", "batchSort", "input"),
    edge("colors", "result", "chunks", "file"),
    edge("chunks", "chunk", "wcChunk", "input"),
    edge("wcChunk", "result", "countFile", "items"),
    edge("countFile", "file", "teeCounts", "input"),
    edge("colors", "result", "wc", "input"),
    edge("pairs", "pairs", "catPairs", "input"),
    edge("catPairs", "result", "sortPairs", "input"),
    edge("table", "records", "catTable", "pair"),
    edge("catTable", "result", "wcTable", "input"),
    edge("span", "range", "catSpan", "pair"),
  ];
  return {
    id: "host",
    name: "主机命令模式链",
    description: "临时测试模块（不是 nf-core）串起通道算子，在本机 Shell 里跑真实文本命令。",
    version: 1,
    nodes,
    edges,
    params: { input, outdir: "results" },
    project: { name: "studio/hostchain", version: "1.0.0", author: "Nextflow Studio" },
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

/** Tiny text files the host-command chain reads. Paths are absolute inside the workflow. */
export function writeHostChainInputs(dir: string) {
  mkdirSync(join(dir, "span"), { recursive: true });
  const files: Record<string, string> = {
    "alpha_1.txt": "apple\nbanana\napple\n",
    "alpha_2.txt": "cherry\nbanana\n",
    "beta_1.txt": "date\napple\n",
    "beta_2.txt": "date\nelder\n",
    "extra_alpha_red.txt": "red\n",
    "extra_alpha_blue.txt": "blue\n",
    "extra_beta_green.txt": "green\n",
    "span/n.1.txt": "one\n",
    "span/n.2.txt": "two\n",
    "span/m.1.txt": "A\n",
    "span/m.2.txt": "B\n",
  };
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  writeFileSync(
    join(dir, "table.csv"),
    `sampleId,read1,read2\nalpha,${join(dir, "alpha_1.txt")},${join(dir, "alpha_2.txt")}\n`,
  );
}
