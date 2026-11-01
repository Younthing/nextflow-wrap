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

/** Insert or remove one indent at a single cursor. Notebook cells use four spaces. */
export function indentAt(
  source: string,
  cursor: number,
  outdent: boolean,
): { source: string; cursor: number } {
  const safe = Math.max(0, Math.min(cursor, source.length));
  const lineStart = source.lastIndexOf("\n", safe - 1) + 1;
  if (outdent) {
    const indent = /^ {1,4}/.exec(source.slice(lineStart));
    if (!indent) return { source, cursor: safe };
    const next = source.slice(0, lineStart) + source.slice(lineStart + indent[0].length);
    return { source: next, cursor: Math.max(lineStart, safe - indent[0].length) };
  }
  return {
    source: source.slice(0, safe) + "    " + source.slice(safe),
    cursor: safe + 4,
  };
}
