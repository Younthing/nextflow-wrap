import type { NotebookCell, NotebookCellRole, NotebookDoc, NotebookLanguage } from "./types";

/**
 * Thin jupytext percent text.
 * Cells use `# %%` / `# %% [markdown]` markers. One extra trailing newline is
 * a terminator, not part of the source, so empty cells and final newlines
 * round-trip. Lines that would look like markers are prefixed with
 * `# <wrap-escape> ` and restored on read.
 */
const ESCAPE_PREFIX = "# <wrap-escape> ";
const ROLES: readonly NotebookCellRole[] = ["code", "markdown", "input", "output", "explore"];

export class PercentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PercentError";
  }
}

export interface PercentNotebook {
  name: string;
  description: string;
  kernel: string;
  language: NotebookLanguage;
  cells: NotebookCell[];
  sourceNotebookId?: string;
  sourceNotebookRev?: number;
}

export interface PercentProvenance {
  sourceNotebookId: string;
  sourceNotebookRev: number;
}

function mapLines(source: string, fn: (line: string) => string): string {
  if (source === "") return "";
  const ends = source.endsWith("\n");
  const core = ends ? source.slice(0, -1) : source;
  const mapped = core.split("\n").map(fn).join("\n");
  return ends ? `${mapped}\n` : mapped;
}

function escapeMarkers(source: string): string {
  return mapLines(source, (line) =>
    line.startsWith("# %%") || line.startsWith(ESCAPE_PREFIX) ? `${ESCAPE_PREFIX}${line}` : line,
  );
}

function unescapeMarkers(source: string): string {
  return mapLines(source, (line) => (line.startsWith(ESCAPE_PREFIX) ? line.slice(ESCAPE_PREFIX.length) : line));
}

function encodeMarkdown(source: string): string {
  if (source === "") return "";
  const ends = source.endsWith("\n");
  const core = ends ? source.slice(0, -1) : source;
  const encoded = core.split("\n").map((line) => (line.length ? `# ${line}` : "#")).join("\n");
  return ends ? `${encoded}\n` : encoded;
}

function decodeMarkdown(encoded: string): string {
  if (encoded === "") return "";
  const ends = encoded.endsWith("\n");
  const core = ends ? encoded.slice(0, -1) : encoded;
  const decoded = core.split("\n").map((line) => {
    if (line === "#") return "";
    if (line.startsWith("# ")) return line.slice(2);
    throw new PercentError("说明单元格无法还原");
  }).join("\n");
  return ends ? `${decoded}\n` : decoded;
}

function writeCell(cell: NotebookCell): string {
  const meta = JSON.stringify({ id: cell.id, wrap_role: cell.role });
  const marker = cell.role === "markdown" ? `# %% [markdown] ${meta}` : `# %% ${meta}`;
  const body = cell.role === "markdown" ? escapeMarkers(encodeMarkdown(cell.source)) : escapeMarkers(cell.source);
  return `${marker}\n${body}\n`;
}

function usableKernel(kernel: string): boolean {
  return kernel.trim().length > 0 && kernel.length <= 80 && !/[\u0000-\u001f]/.test(kernel);
}

export function writePercent(
  notebook: Pick<NotebookDoc, "name" | "description" | "kernel" | "language" | "cells">,
  provenance?: PercentProvenance,
): string {
  if (!usableKernel(notebook.kernel)) throw new PercentError("内核无效");
  const language: NotebookLanguage = notebook.language === "r" ? "r" : "python";
  const extension = language === "r" ? ".R" : ".py";
  const formats = language === "r" ? "ipynb,R:percent" : "ipynb,py:percent";
  const wrap = JSON.stringify({
    name: notebook.name,
    description: notebook.description,
    kernel: notebook.kernel,
    language,
    ...(provenance
      ? { sourceNotebookId: provenance.sourceNotebookId, sourceNotebookRev: provenance.sourceNotebookRev }
      : {}),
  });
  const header = [
    "# ---",
    "# jupyter:",
    "#   jupytext:",
    `#     formats: ${formats}`,
    "#     text_representation:",
    `#       extension: ${extension}`,
    "#       format_name: percent",
    "#       format_version: '1.3'",
    "#   kernelspec:",
    `#     display_name: ${notebook.kernel}`,
    `#     language: ${language}`,
    `#     name: ${notebook.kernel}`,
    "# ---",
    `# wrap: ${wrap}`,
  ].join("\n");
  return `${header}\n\n${notebook.cells.map(writeCell).join("")}`;
}

function parseMeta(raw: string): Omit<PercentNotebook, "cells"> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new PercentError("wrap 元数据不是 JSON");
  }
  if (!value || typeof value !== "object") throw new PercentError("wrap 元数据无效");
  const meta = value as Record<string, unknown>;
  if (typeof meta.name !== "string" || !meta.name.trim()) throw new PercentError("缺少笔记本名称");
  if (typeof meta.description !== "string") throw new PercentError("缺少笔记本说明");
  if (typeof meta.kernel !== "string" || !usableKernel(meta.kernel)) throw new PercentError("内核无效");
  if (meta.language !== "python" && meta.language !== "r") throw new PercentError("语言无效");
  if (meta.sourceNotebookId !== undefined && typeof meta.sourceNotebookId !== "string") throw new PercentError("源笔记本无效");
  const sourceNotebookRev = typeof meta.sourceNotebookRev === "number" && Number.isInteger(meta.sourceNotebookRev) && meta.sourceNotebookRev >= 1
    ? meta.sourceNotebookRev
    : undefined;
  if (meta.sourceNotebookRev !== undefined && sourceNotebookRev === undefined) throw new PercentError("源修订无效");
  return {
    name: meta.name,
    description: meta.description,
    kernel: meta.kernel,
    language: meta.language,
    sourceNotebookId: typeof meta.sourceNotebookId === "string" ? meta.sourceNotebookId : undefined,
    sourceNotebookRev,
  };
}

function cellRole(markdown: boolean, value: unknown): NotebookCellRole {
  if (value === undefined) return markdown ? "markdown" : "code";
  if (typeof value !== "string" || !ROLES.includes(value as NotebookCellRole)) throw new PercentError("单元格角色无效");
  const role = value as NotebookCellRole;
  if (markdown !== (role === "markdown")) throw new PercentError("单元格角色和类型不一致");
  return role;
}

function parseCells(rest: string): NotebookCell[] {
  const re = /^# %%(?: \[markdown\])?(?: (\{.*\}))?$/gm;
  const markers = [...rest.matchAll(re)];
  if (markers.length === 0 || markers[0]?.index !== 0) throw new PercentError("缺少单元格");
  const cells: NotebookCell[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    const line = marker[0];
    let meta: { id?: unknown; wrap_role?: unknown } = {};
    if (marker[1]) {
      try {
        meta = JSON.parse(marker[1]) as { id?: unknown; wrap_role?: unknown };
      } catch {
        throw new PercentError("单元格元数据不是 JSON");
      }
    }
    const start = (marker.index ?? 0) + line.length;
    if (rest[start] !== "\n") throw new PercentError("单元格标记后需要换行");
    const end = index + 1 < markers.length ? (markers[index + 1]?.index ?? rest.length) : rest.length;
    let raw = rest.slice(start + 1, end);
    if (!raw.endsWith("\n")) throw new PercentError("单元格缺少结束换行");
    raw = raw.slice(0, -1);
    const role = cellRole(line.startsWith("# %% [markdown]"), meta.wrap_role);
    const source = role === "markdown" ? decodeMarkdown(unescapeMarkers(raw)) : unescapeMarkers(raw);
    const id = typeof meta.id === "string" && meta.id.length > 0 && meta.id.length <= 80 ? meta.id : `c${index + 1}`;
    if (seen.has(id)) throw new PercentError(`重复的单元格 ${id}`);
    seen.add(id);
    cells.push({ id, role, source });
  }
  return cells;
}

export function readPercent(text: string): PercentNotebook {
  if (!text.startsWith("# ---\n")) throw new PercentError("不是 jupytext percent 笔记本");
  const headerEnd = text.indexOf("\n# ---\n");
  if (headerEnd < 0) throw new PercentError("缺少 jupytext 头");
  const after = text.slice(headerEnd + "\n# ---\n".length);
  if (!after.startsWith("# wrap: ")) throw new PercentError("缺少 wrap 元数据");
  const newline = after.indexOf("\n");
  if (newline < 0) throw new PercentError("wrap 元数据不完整");
  const meta = parseMeta(after.slice("# wrap: ".length, newline));
  let rest = after.slice(newline + 1);
  if (rest.startsWith("\n")) rest = rest.slice(1);
  return { ...meta, cells: parseCells(rest) };
}
