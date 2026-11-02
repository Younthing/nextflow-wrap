import { kernelLabel, languageForKernel, type NotebookCell, type NotebookCellRole, type NotebookDoc } from "@/features/notebook/types";

/**
 * Notebooks are stored as standard nbformat 4.5 `.ipynb` files, so JupyterLab, VS Code and Git all read them.
 * What the app adds lives under `metadata.nextflow_studio`, which Jupyter keeps when it saves:
 * - notebook level: id, description and where a rebuilt notebook came from;
 * - cell level: the role of input, output and explore cells. Plain code and markdown cells carry nothing.
 */
export const IPYNB_KEY = "nextflow_studio";

const CELL_MAX = 80;
const SOURCE_MAX = 50_000;
const ID = /^[\w-]{1,80}$/;

export class IpynbError extends Error {}

interface IpynbCell {
  cell_type: "code" | "markdown" | "raw";
  id?: string;
  metadata: Record<string, unknown>;
  source: string | string[];
  outputs?: unknown[];
  execution_count?: number | null;
}

export interface Ipynb {
  nbformat: number;
  nbformat_minor: number;
  metadata: Record<string, unknown>;
  cells: IpynbCell[];
}

/** Notebook-level fields the file carries. `rev`, timestamps and kernel state stay in the database. */
export type IpynbNotebook = Pick<NotebookDoc, "name" | "description" | "kernel" | "language" | "cells">
  & Partial<Pick<NotebookDoc, "id" | "libraryModuleId" | "librarySourceNotebookId" | "librarySourceNotebookRev">>;

/** Split source the way Jupyter writes it: one string per line, each keeping its newline. */
function sourceLines(source: string): string[] {
  return source.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function writeCell(cell: NotebookCell): IpynbCell {
  const metadata = cell.role === "code" || cell.role === "markdown" ? {} : { [IPYNB_KEY]: { role: cell.role } };
  if (cell.role === "markdown") return { cell_type: "markdown", id: cell.id, metadata, source: sourceLines(cell.source) };
  return { cell_type: "code", id: cell.id, metadata, source: sourceLines(cell.source), outputs: [], execution_count: null };
}

export function notebookToIpynb(doc: IpynbNotebook): Ipynb {
  const language = doc.language === "r" ? "R" : "python";
  const studio: Record<string, unknown> = { id: doc.id, description: doc.description };
  if (doc.libraryModuleId) studio.libraryModuleId = doc.libraryModuleId;
  if (doc.librarySourceNotebookId) studio.librarySourceNotebookId = doc.librarySourceNotebookId;
  if (doc.librarySourceNotebookRev !== undefined) studio.librarySourceNotebookRev = doc.librarySourceNotebookRev;
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: { name: doc.kernel, display_name: kernelLabel(doc.kernel), language: doc.language },
      language_info: { name: language },
      [IPYNB_KEY]: { ...studio, name: doc.name },
    },
    cells: doc.cells.map(writeCell),
  };
}

/** Stable text for a notebook file: JSON indented by one space with a trailing newline, as Jupyter writes it. Outputs are not kept. */
export function serializeIpynb(doc: IpynbNotebook): string {
  return `${JSON.stringify(notebookToIpynb(doc), null, 1)}\n`;
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

const text = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((line) => typeof line === "string")) return value.join("");
  throw new IpynbError("单元格内容无效");
};

const ROLES: NotebookCellRole[] = ["input", "output", "explore"];

function readCell(raw: unknown, index: number, used: Set<string>): NotebookCell | undefined {
  const cell = record(raw);
  if (cell.cell_type === "raw") return undefined;
  if (cell.cell_type !== "code" && cell.cell_type !== "markdown") throw new IpynbError(`第 ${index + 1} 个单元格类型无效`);
  const source = text(cell.source);
  if (source.length > SOURCE_MAX) throw new IpynbError(`第 ${index + 1} 个单元格过长`);
  const marked = record(record(cell.metadata)[IPYNB_KEY]).role;
  const role: NotebookCellRole = cell.cell_type === "markdown"
    ? "markdown"
    : ROLES.includes(marked as NotebookCellRole) ? marked as NotebookCellRole : "code";
  // Jupyter before nbformat 4.5 wrote no ids; keep the ones that are usable and unique.
  let id = typeof cell.id === "string" && ID.test(cell.id) && !used.has(cell.id) ? cell.id : `c${index + 1}`;
  for (let n = 2; used.has(id); n += 1) id = `c${index + 1}_${n}`;
  used.add(id);
  return { id, role, source };
}

/**
 * Read an `.ipynb` file. A notebook made outside the app (no `nextflow_studio` metadata) is accepted:
 * its name comes from `fallbackName`, its kernel from `kernelspec`, and every code cell is a plain code cell.
 */
export function notebookFromIpynb(raw: string, fallbackName: string): IpynbNotebook {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new IpynbError("不是有效的 .ipynb（JSON 解析失败）");
  }
  const nb = record(value);
  if (nb.nbformat !== 4) throw new IpynbError("只支持 nbformat 4");
  if (!Array.isArray(nb.cells)) throw new IpynbError("缺少 cells");
  const metadata = record(nb.metadata);
  const studio = record(metadata[IPYNB_KEY]);
  const kernelspec = record(metadata.kernelspec);
  const kernel = typeof kernelspec.name === "string" && kernelspec.name.trim() && !/[\u0000-\u001f]/.test(kernelspec.name)
    ? kernelspec.name.trim().slice(0, 80)
    : "python3";
  const used = new Set<string>();
  const cells = nb.cells.map((cell, index) => readCell(cell, index, used)).filter((cell): cell is NotebookCell => Boolean(cell));
  if (cells.length > CELL_MAX) throw new IpynbError(`单元格超过 ${CELL_MAX} 个`);
  const name = typeof studio.name === "string" && studio.name.trim() ? studio.name.trim().slice(0, 80) : fallbackName;
  const doc: IpynbNotebook = {
    name,
    description: typeof studio.description === "string" ? studio.description.slice(0, 2000) : "",
    kernel,
    language: kernelspec.language === "R" || kernelspec.language === "r" ? "r" : languageForKernel(kernel),
    cells: cells.length ? cells : [{ id: "c1", role: "code", source: "" }],
  };
  if (typeof studio.id === "string" && ID.test(studio.id)) doc.id = studio.id;
  if (typeof studio.libraryModuleId === "string") doc.libraryModuleId = studio.libraryModuleId;
  if (typeof studio.librarySourceNotebookId === "string") doc.librarySourceNotebookId = studio.librarySourceNotebookId;
  if (typeof studio.librarySourceNotebookRev === "number" && Number.isInteger(studio.librarySourceNotebookRev)) {
    doc.librarySourceNotebookRev = studio.librarySourceNotebookRev;
  }
  return doc;
}
