import type { NotebookLanguage } from "./types";

export type HighlightKind = "comment" | "string" | "keyword" | "number" | "call";

export interface HighlightToken {
  text: string;
  kind?: HighlightKind;
}

/** Same classes as the project code viewer. Calls reuse the key token. */
export const HIGHLIGHT_CLASS: Record<HighlightKind, string> = {
  comment: "tok-comment",
  string: "tok-string",
  keyword: "tok-keyword",
  number: "tok-number",
  call: "tok-key",
};

const PYTHON_KEYWORDS = new Set([
  "False", "None", "True", "and", "as", "assert", "async", "await", "break", "class",
  "continue", "def", "del", "elif", "else", "except", "finally", "for", "from", "global",
  "if", "import", "in", "is", "lambda", "nonlocal", "not", "or", "pass", "raise", "return",
  "try", "while", "with", "yield",
]);

const R_KEYWORDS = new Set([
  "if", "else", "repeat", "while", "function", "for", "in", "next", "break",
  "TRUE", "FALSE", "NULL", "Inf", "NA", "NaN",
  "NA_integer_", "NA_real_", "NA_complex_", "NA_character_",
]);

function keywordsFor(language: NotebookLanguage): Set<string> {
  return language === "r" ? R_KEYWORDS : PYTHON_KEYWORDS;
}

function isIdentStart(char: string, language: NotebookLanguage): boolean {
  if (language === "r" && char === ".") return true;
  return /[A-Za-z_\u00A0-\uFFFF]/.test(char);
}

function isIdentPart(char: string, language: NotebookLanguage): boolean {
  if (language === "r" && char === ".") return true;
  return /[\w\u00A0-\uFFFF]/.test(char);
}

function readIdent(source: string, index: number, language: NotebookLanguage): number | null {
  if (!isIdentStart(source[index] ?? "", language)) return null;
  let i = index + 1;
  while (i < source.length && isIdentPart(source[i] ?? "", language)) i += 1;
  return i;
}

/** Prefixes such as r, f, b, fr before a Python quote. */
function readPythonStringPrefix(source: string, index: number): number {
  const match = /^(?:[rRuUbBfF]{1,2})/.exec(source.slice(index));
  if (!match) return index;
  const quote = source[index + match[0].length];
  if (quote !== "'" && quote !== '"') return index;
  return index + match[0].length;
}

function readString(source: string, index: number, language: NotebookLanguage): number | null {
  let i = language === "python" ? readPythonStringPrefix(source, index) : index;
  const quote = source[i];
  if (quote !== "'" && quote !== '"') return null;
  const triple = source.startsWith(quote + quote + quote, i);
  const fence = triple ? quote.repeat(3) : quote;
  i += fence.length;
  while (i < source.length) {
    if (source[i] === "\\") {
      i += Math.min(2, source.length - i);
      continue;
    }
    if (!triple && source[i] === "\n") return i;
    if (source.startsWith(fence, i)) return i + fence.length;
    i += 1;
  }
  return source.length;
}

function readNumber(source: string, index: number): number | null {
  const match = /^(?:0[xX][0-9A-Fa-f_]+|\d[\d_]*(?:\.\d[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?[Ll]?/.exec(source.slice(index));
  if (!match) return null;
  return index + match[0].length;
}

function isCall(source: string, index: number): boolean {
  let i = index;
  while (source[i] === " " || source[i] === "\t") i += 1;
  return source[i] === "(";
}

function pushToken(tokens: HighlightToken[], text: string, kind?: HighlightKind) {
  if (!text) return;
  const prev = tokens[tokens.length - 1];
  if (prev && prev.kind === kind) {
    prev.text += text;
    return;
  }
  tokens.push(kind ? { text, kind } : { text });
}

export function highlightSource(source: string, language: NotebookLanguage): HighlightToken[] {
  const keywords = keywordsFor(language);
  const tokens: HighlightToken[] = [];
  let i = 0;
  while (i < source.length) {
    if (source[i] === "#") {
      const end = source.indexOf("\n", i);
      const stop = end < 0 ? source.length : end;
      pushToken(tokens, source.slice(i, stop), "comment");
      i = stop;
      continue;
    }
    const stringEnd = readString(source, i, language);
    if (stringEnd !== null && stringEnd > i) {
      pushToken(tokens, source.slice(i, stringEnd), "string");
      i = stringEnd;
      continue;
    }
    const numberEnd = readNumber(source, i);
    if (numberEnd !== null) {
      pushToken(tokens, source.slice(i, numberEnd), "number");
      i = numberEnd;
      continue;
    }
    const identEnd = readIdent(source, i, language);
    if (identEnd !== null) {
      const word = source.slice(i, identEnd);
      const kind: HighlightKind | undefined = keywords.has(word)
        ? "keyword"
        : isCall(source, identEnd) ? "call" : undefined;
      pushToken(tokens, word, kind);
      i = identEnd;
      continue;
    }
    pushToken(tokens, source[i] ?? "");
    i += 1;
  }
  return tokens;
}

/** What the cursor is sitting in. A cursor on a boundary counts as code. */
export function syntaxContext(
  source: string,
  cursor: number,
  language: NotebookLanguage,
): "code" | "string" | "comment" {
  const tokens = highlightSource(source, language);
  let offset = 0;
  for (const token of tokens) {
    const next = offset + token.text.length;
    if (cursor > offset && cursor <= next) {
      if (token.kind === "string" || token.kind === "comment") return token.kind;
      return "code";
    }
    offset = next;
  }
  return "code";
}

const PYTHON_IDENT = /[A-Za-z_\u00A0-\uFFFF][\w\u00A0-\uFFFF]*/g;
const R_IDENT = /[A-Za-z.\u00A0-\uFFFF][\w.\u00A0-\uFFFF]*/g;

/** Identifiers in code, including calls. Strings and comments are skipped. */
export function codeWords(source: string, language: NotebookLanguage): string[] {
  const pattern = language === "r" ? R_IDENT : PYTHON_IDENT;
  const words: string[] = [];
  for (const token of highlightSource(source, language)) {
    if (token.kind && token.kind !== "call") continue;
    pattern.lastIndex = 0;
    for (const match of token.text.matchAll(pattern)) words.push(match[0]);
  }
  return words;
}
