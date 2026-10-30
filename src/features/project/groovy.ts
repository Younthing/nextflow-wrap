/**
 * Template tag for Nextflow/Groovy source. Groovy's `${…}` would clash with
 * JS interpolation, so templates write it as `@{…}` and this tag turns it back.
 */
export function nf(strings: TemplateStringsArray, ...values: unknown[]): string {
  let out = "";
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) out += String(values[i]);
  });
  return out.replaceAll("@{", "${");
}

/** A Groovy single-quoted string literal. */
export function gstr(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

/** A Groovy literal for a widget value. */
export function gvalue(value: string | number | boolean | undefined): string {
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (value === undefined || value === "") return "''";
  return gstr(value);
}

/**
 * `ext.prefix`/`ext.args` may reference task variables (`${meta.id}`); those
 * need a closure with a GString, plain text a simple string literal.
 */
export function gdynamic(value: string): string {
  if (!value.includes("${")) return gstr(value);
  return `{ "${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}" }`;
}

export function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line ? pad + line : line))
    .join("\n");
}

export const BANNER = "~".repeat(88);

export function section(title: string): string {
  return `/*\n${BANNER}\n    ${title}\n${BANNER}\n*/`;
}
