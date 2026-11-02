import type { MarkerInput, NotebookCell, NotebookLanguage } from "./types";

/**
 * Values a canvas node hands to its source notebook: widget values and the paths of
 * upstream file and folder inputs, keyed by the notebook's `@input` names.
 */
export interface CanvasValues {
  /** Alias of the canvas node the values came from, such as SCANPY_QC. */
  from: string;
  values: Record<string, string>;
}

const FROM_KEY = "from";
const VALUE_PREFIX = "set.";

/** `/workbench/<notebook>?from=ALIAS&set.<input>=<value>…` */
export function sourceNotebookHref(notebookId: string, canvas?: CanvasValues): string {
  const base = `/workbench/${encodeURIComponent(notebookId)}`;
  if (!canvas || !Object.keys(canvas.values).length) return base;
  const query = new URLSearchParams();
  query.set(FROM_KEY, canvas.from);
  for (const [name, value] of Object.entries(canvas.values)) query.set(`${VALUE_PREFIX}${name}`, value);
  return `${base}?${query.toString()}`;
}

export function readCanvasValues(query: Pick<URLSearchParams, "forEach" | "get">): CanvasValues | null {
  const values: Record<string, string> = {};
  query.forEach((value, key) => {
    if (key.startsWith(VALUE_PREFIX) && key.length > VALUE_PREFIX.length) values[key.slice(VALUE_PREFIX.length)] = value;
  });
  if (!Object.keys(values).length) return null;
  return { from: query.get(FROM_KEY) ?? "", values };
}

const INPUT_LINE = /^\s*#\s*@input\b/;
const NAME_FIELD = /(?:^|\s)name=["']?([A-Za-z_]\w*)/;

function inputName(line: string): string | null {
  if (!INPUT_LINE.test(line)) return null;
  return NAME_FIELD.exec(line)?.[1] ?? null;
}

const isNumberType = (type: string) => ["int", "integer", "float", "number"].includes(type);
const isBoolType = (type: string) => type === "bool" || type === "boolean";

/** The value as a literal the notebook's language reads, or null when it does not fit the type. */
export function inputLiteral(input: MarkerInput, value: string, language: NotebookLanguage): string | null {
  const raw = value.trim();
  if (isNumberType(input.type)) {
    if (!raw || !Number.isFinite(Number(raw))) return null;
    return raw;
  }
  if (isBoolType(input.type)) {
    const on = raw === "true" || raw === "1";
    if (!on && raw !== "false" && raw !== "0") return null;
    if (language === "r") return on ? "TRUE" : "FALSE";
    return on ? "True" : "False";
  }
  if (input.type.endsWith("[]")) {
    const items = raw.split(/[\s,]+/).filter(Boolean).map((item) => JSON.stringify(item));
    if (!items.length) return null;
    return language === "r" ? `c(${items.join(", ")})` : `[${items.join(", ")}]`;
  }
  return JSON.stringify(value);
}

export interface AppliedValue {
  name: string;
  literal: string;
}

/**
 * Write `name = <literal>` under each input's marker, replacing an existing assignment.
 * The converter strips these lines from the published script, so they only change the
 * values the notebook uses while it is run cell by cell.
 */
export function applyCanvasValues(
  cells: NotebookCell[],
  inputs: MarkerInput[],
  values: Record<string, string>,
  language: NotebookLanguage,
): { cells: NotebookCell[]; applied: AppliedValue[] } {
  const byName = new Map(inputs.map((input) => [input.name, input]));
  const applied: AppliedValue[] = [];
  const next = cells.map((cell) => {
    if (cell.role === "markdown" || cell.role === "explore") return cell;
    const lines = cell.source.split("\n");
    const declared = lines.map(inputName).filter((name): name is string => !!name);
    if (!declared.length) return cell;
    const declaredSet = new Set(declared);
    const assignment = (line: string) => {
      // R cells often assign with `<-`; both are replaced by `name = value`.
      const match = /^([A-Za-z_][\w.]*)\s*(?:=(?!=)|<-)/.exec(line);
      return match && declaredSet.has(match[1]) ? match[1] : null;
    };
    let changed = false;
    for (const name of declared) {
      const input = byName.get(name);
      const value = values[name];
      if (!input || value === undefined) continue;
      const literal = inputLiteral(input, value, language);
      if (literal === null) continue;
      const line = `${name} = ${literal}`;
      const at = lines.findIndex((item) => assignment(item) === name);
      if (at >= 0) {
        if (lines[at] !== line) changed = true;
        lines[at] = line;
      } else {
        // After the leading block of markers and assignments.
        let end = -1;
        lines.forEach((item, index) => {
          if (inputName(item) || /^\s*#\s*@output\b/.test(item) || assignment(item)) end = index;
        });
        lines.splice(end + 1, 0, line);
        changed = true;
      }
      applied.push({ name, literal });
    }
    return changed ? { ...cell, source: lines.join("\n") } : cell;
  });
  return { cells: next, applied };
}
