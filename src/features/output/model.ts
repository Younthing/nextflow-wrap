import type { SafeNode } from "@/features/notebook/html-sanitize";

export type ImageMime = "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/svg+xml";

/** One renderable output. Notebook cells and run files both produce this. */
export type OutputView =
  | { kind: "html"; nodes: SafeNode[] }
  | { kind: "html-document"; html: string; title: string }
  | { kind: "image"; mime: ImageMime; src: string; alt: string }
  | { kind: "pdf"; src: string; title: string }
  | { kind: "table"; columns: string[]; rows: string[][]; truncated: boolean }
  | { kind: "markdown"; source: string }
  | { kind: "text"; text: string }
  | { kind: "empty" };

const MAX_ROWS = 500;
const MAX_COLS = 40;
const MAX_CELL = 2_000;
const MAX_CHARS = 1_000_000;
const MAX_PDF = 2_000_000;

export interface DelimitedTable {
  columns: string[];
  rows: string[][];
  truncated: boolean;
}

/** Parse a CSV or TSV preview. Quoted commas, quotes, and newlines stay in the cell. */
export function parseDelimited(source: string, delimiter: "," | "\t"): DelimitedTable {
  const withoutBom = source.replace(/^\uFEFF/, "");
  const clipped = withoutBom.length > MAX_CHARS;
  const text = clipped ? withoutBom.slice(0, MAX_CHARS) : withoutBom;
  const records: string[][] = [];
  let truncated = clipped;
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  const pushCell = () => {
    if (cell.length > MAX_CELL) {
      cell = `${cell.slice(0, MAX_CELL)}…`;
      truncated = true;
    }
    row.push(cell);
    cell = "";
  };

  const pushRow = () => {
    if (row.length > MAX_COLS) {
      row = row.slice(0, MAX_COLS);
      truncated = true;
    }
    const blank = row.every((value) => value === "");
    if (!(blank && records.length === 0)) {
      if (records.length > MAX_ROWS) truncated = true;
      else records.push(row);
    }
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === "\"") {
        if (text[index + 1] === "\"") {
          cell += "\"";
          index += 1;
        } else quoted = false;
      } else cell += char;
      continue;
    }
    if (char === "\"" && cell === "") {
      quoted = true;
      continue;
    }
    if (char === delimiter) {
      pushCell();
      continue;
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      pushCell();
      pushRow();
      if (truncated && records.length > MAX_ROWS) break;
      continue;
    }
    cell += char;
  }
  if (cell.length > 0 || row.length > 0) {
    pushCell();
    pushRow();
  }

  const [header, ...rows] = records;
  if (!header || header.every((value) => value.trim() === "")) return { columns: [], rows: [], truncated };
  const width = header.length;
  return {
    columns: header.map((value) => value.trim()),
    rows: rows.map((record) => {
      const next = record.slice(0, width);
      while (next.length < width) next.push("");
      return next;
    }),
    truncated,
  };
}

/** A PDF data URL, or undefined when the payload is not a PDF. */
export function pdfDataUrl(payload: string): string | undefined {
  const compact = payload.replace(/\s/g, "");
  if (!compact || compact.length > MAX_PDF) return undefined;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return undefined;
  if (!compact.startsWith("JVBERi")) return undefined;
  return `data:application/pdf;base64,${compact}`;
}

export function viewFromTable(text: string, delimiter: "," | "\t"): OutputView {
  const table = parseDelimited(text, delimiter);
  if (table.columns.length === 0) return { kind: "text", text };
  return { kind: "table", columns: table.columns, rows: table.rows, truncated: table.truncated };
}

export function viewFromText(preview: "markdown" | "csv" | "tsv" | "text", body: string): OutputView {
  if (preview === "markdown") return { kind: "markdown", source: body };
  if (preview === "csv") return viewFromTable(body, ",");
  if (preview === "tsv") return viewFromTable(body, "\t");
  return { kind: "text", text: body };
}
