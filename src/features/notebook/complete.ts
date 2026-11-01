import { codeWords, syntaxContext } from "./highlight";
import type { NotebookLanguage } from "./types";

const PYTHON_BUILTINS = [
  "abs", "all", "any", "ascii", "bin", "bool", "bytearray", "bytes", "callable", "chr",
  "classmethod", "compile", "complex", "delattr", "dict", "dir", "divmod", "enumerate",
  "eval", "exec", "filter", "float", "format", "frozenset", "getattr", "globals", "hasattr",
  "hash", "help", "hex", "id", "input", "int", "isinstance", "issubclass", "iter", "len",
  "list", "locals", "map", "max", "memoryview", "min", "next", "object", "oct", "open",
  "ord", "pow", "print", "property", "range", "repr", "reversed", "round", "set", "setattr",
  "slice", "sorted", "staticmethod", "str", "sum", "super", "tuple", "type", "vars", "zip",
  "Exception", "ValueError", "TypeError", "KeyError", "IndexError", "RuntimeError",
  "pd", "np", "plt", "df",
];

const R_BUILTINS = [
  "c", "seq", "paste", "paste0", "mean", "sum", "length", "names", "str", "head", "tail",
  "print", "cat", "library", "require", "source", "ggplot", "aes", "geom_point", "geom_col",
  "geom_histogram", "filter", "select", "mutate", "summarise", "group_by", "arrange",
  "read.csv", "read.table", "write.csv", "data.frame", "list", "factor", "matrix", "nrow",
  "ncol", "colnames", "rownames", "subset", "merge", "lapply", "sapply", "apply", "t.test",
  "glm", "lm", "plot", "hist", "boxplot", "summary", "levels", "as.factor", "as.numeric",
  "as.character", "is.na", "na.omit", "rbind", "cbind", "rep", "which", "ifelse",
];

const PYTHON_PREFIX = /[A-Za-z_\u00A0-\uFFFF][\w\u00A0-\uFFFF]*$/;
const R_PREFIX = /[A-Za-z.\u00A0-\uFFFF][\w.\u00A0-\uFFFF]*$/;

export const COMPLETION_LIMIT = 20;

export interface Completion {
  start: number;
  prefix: string;
  items: string[];
}

function poolFor(language: NotebookLanguage, source: string, scope: string): string[] {
  const builtins = language === "r" ? R_BUILTINS : PYTHON_BUILTINS;
  const words = new Set<string>([...builtins, ...codeWords(source, language), ...codeWords(scope, language)]);
  return [...words];
}

export function completeAt(
  language: NotebookLanguage,
  source: string,
  cursor: number,
  scope = "",
): Completion | null {
  const safeCursor = Math.max(0, Math.min(cursor, source.length));
  if (syntaxContext(source, safeCursor, language) !== "code") return null;
  const before = source.slice(0, safeCursor);
  const match = before.match(language === "r" ? R_PREFIX : PYTHON_PREFIX);
  const prefix = match?.[0] ?? "";
  const items = suggest(poolFor(language, source, scope), prefix);
  if (items.length === 0) return null;
  return { start: safeCursor - prefix.length, prefix, items };
}

function suggest(words: string[], prefix: string): string[] {
  const lower = prefix.toLowerCase();
  const matched = words.filter((word) => word !== prefix && (word.startsWith(prefix) || word.toLowerCase().startsWith(lower)));
  matched.sort((a, b) => {
    const aExact = a.startsWith(prefix) ? 0 : 1;
    const bExact = b.startsWith(prefix) ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    if (a.length !== b.length) return a.length - b.length;
    return a.localeCompare(b);
  });
  return matched.slice(0, COMPLETION_LIMIT);
}

export function applyCompletion(
  source: string,
  cursor: number,
  start: number,
  word: string,
): { source: string; cursor: number } {
  const safeStart = Math.max(0, Math.min(start, cursor, source.length));
  const safeCursor = Math.max(safeStart, Math.min(cursor, source.length));
  return {
    source: source.slice(0, safeStart) + word + source.slice(safeCursor),
    cursor: safeStart + word.length,
  };
}

/** Notebook cells indent with four spaces, the same width Jupyter inserts. */
export const INDENT = "    ";

export type TabEdit =
  | { type: "complete"; completion: Completion }
  | { type: "indent" }
  | { type: "outdent" };

/**
 * Tab completes only when the caret sits immediately after an identifier prefix.
 * A blank line, whitespace, or a selection indents. Shift+Tab always outdents.
 * An empty-prefix list is for Ctrl+Space, not Tab.
 */
export function tabEdit(
  language: NotebookLanguage,
  source: string,
  start: number,
  end: number,
  shift: boolean,
  scope = "",
): TabEdit {
  if (shift) return { type: "outdent" };
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  if (from !== to) return { type: "indent" };
  const found = completeAt(language, source, from, scope);
  if (found && found.prefix.length > 0 && found.items.length > 0) {
    return { type: "complete", completion: found };
  }
  return { type: "indent" };
}

export interface IndentResult {
  source: string;
  start: number;
  end: number;
}

/** Insert indentation at the caret, or indent / outdent every line in the selection. */
export function indentAt(
  source: string,
  start: number,
  end: number,
  outdent: boolean,
): IndentResult {
  const from = clamp(Math.min(start, end), source.length);
  const to = clamp(Math.max(start, end), source.length);
  if (!outdent && from === to) {
    return {
      source: source.slice(0, from) + INDENT + source.slice(from),
      start: from + INDENT.length,
      end: from + INDENT.length,
    };
  }
  return indentLines(source, from, to, outdent);
}

function clamp(index: number, length: number): number {
  return Math.max(0, Math.min(index, length));
}

function removableIndent(line: string): number {
  if (line.startsWith("\t")) return 1;
  const spaces = /^ */.exec(line)?.[0].length ?? 0;
  return Math.min(INDENT.length, spaces);
}

function lineBlock(source: string, from: number, to: number): { start: number; end: number } {
  const start = source.lastIndexOf("\n", Math.max(0, from - 1)) + 1;
  let endIndex = to;
  if (to > from && source[to - 1] === "\n") endIndex = to - 1;
  const lineEnd = source.indexOf("\n", endIndex);
  return { start, end: lineEnd === -1 ? source.length : lineEnd };
}

function indentLines(source: string, from: number, to: number, outdent: boolean): IndentResult {
  const block = lineBlock(source, from, to);
  const lines = source.slice(block.start, block.end).split("\n");
  const nextLines = lines.map((line) => {
    if (!outdent) return INDENT + line;
    return line.slice(removableIndent(line));
  });
  const nextBlock = nextLines.join("\n");
  const next = source.slice(0, block.start) + nextBlock + source.slice(block.end);
  const mapOffset = (offset: number) => {
    let consumed = 0;
    let produced = 0;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      const edited = nextLines[index] ?? "";
      const lineEnd = consumed + line.length;
      if (offset <= lineEnd || index === lines.length - 1) {
        const within = Math.max(0, offset - consumed);
        if (outdent) {
          const removed = line.length - edited.length;
          return produced + (within <= removed ? 0 : within - removed);
        }
        return produced + within + (edited.length - line.length);
      }
      consumed = lineEnd + 1;
      produced += edited.length + 1;
    }
    return produced;
  };
  const start = block.start + mapOffset(from - block.start);
  const end = block.start + mapOffset(to - block.start);
  return { source: next, start, end };
}
