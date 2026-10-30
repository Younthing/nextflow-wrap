import type { ChannelElement, ModuleDef, PortDef } from "./types";

export const inHandle = (port: string) => `in:${port}`;
export const outHandle = (port: string) => `out:${port}`;
export const portFromHandle = (handle: string | null | undefined) =>
  handle?.replace(/^(in|out):/, "") ?? "";

/** Short type label shown next to a socket, e.g. `meta, bam, bai`. */
export function portSignature(port: PortDef): string {
  return port.elements
    .map((el) => (el.kind === "meta" ? "meta" : el.kind === "value" ? el.type : (el.format ?? "file")))
    .join(", ");
}

/** The colour family a socket uses: what the channel mainly carries. */
export function portKind(port: PortDef): "file" | "value" | "meta" | "path" {
  const payload = port.elements.filter((el) => el.kind !== "meta");
  if (payload.length === 0) return "meta";
  if (payload.every((el) => el.kind === "value")) return "value";
  if (payload.some((el) => el.type === "directory")) return "path";
  return "file";
}

/**
 * How an output channel has to be reshaped to fit an input:
 * - `direct`: shapes match.
 * - `pad`: the input tuple has extra trailing (optional) files, filled with `[]`.
 * - `strip-meta`: the input takes bare files, so the meta map is dropped.
 */
export type Adapter = "direct" | "pad" | "strip-meta";

export interface Compatibility {
  ok: boolean;
  adapter?: Adapter;
  /** Set when the link is allowed but probably wrong (format mismatch). */
  warning?: string;
  reason?: string;
  /** Input elements filled with `[]` by the `pad` adapter. */
  padded?: string[];
}

function sameKind(a: ChannelElement, b: ChannelElement) {
  return a.kind === b.kind;
}

export function checkCompatibility(source: PortDef, target: PortDef): Compatibility {
  if (target.widget) return { ok: false, reason: "这是参数控件，不接受连线" };

  let src = source.elements;
  const dst = target.elements;
  let adapter: Adapter = "direct";

  if (src[0]?.kind === "meta" && dst[0]?.kind !== "meta") {
    src = src.slice(1);
    adapter = "strip-meta";
  }

  if (src.length > dst.length) {
    return { ok: false, reason: `输出有 ${src.length} 个元素，输入只接受 ${dst.length} 个` };
  }

  for (let i = 0; i < src.length; i++) {
    if (!sameKind(src[i], dst[i])) {
      return { ok: false, reason: `第 ${i + 1} 个元素类型不同：${src[i].kind} → ${dst[i].kind}` };
    }
  }

  const rest = dst.slice(src.length);
  if (rest.some((el) => el.kind !== "file")) {
    return { ok: false, reason: "缺少的元素不是可选文件，无法自动补齐" };
  }
  if (rest.length > 0 && adapter === "direct") adapter = "pad";

  const mismatches = src
    .map((el, i) => [el, dst[i]] as const)
    .filter(([a, b]) => a.format && b.format && a.format !== b.format)
    .map(([a, b]) => `${a.format} → ${b.format}`);

  return {
    ok: true,
    adapter,
    padded: adapter === "pad" ? rest.map((el) => el.name) : undefined,
    warning: mismatches.length ? `文件格式可能不匹配：${mismatches.join("，")}` : undefined,
  };
}

export function findPort(def: ModuleDef, handle: string | null | undefined, side: "in" | "out") {
  const name = portFromHandle(handle);
  return (side === "in" ? def.inputs : def.outputs).find((p) => p.name === name);
}

/** Inputs drawn as sockets (everything except value widgets). */
export const socketInputs = (def: ModuleDef) => def.inputs.filter((p) => !p.widget);
export const widgetInputs = (def: ModuleDef) => def.inputs.filter((p) => p.widget);
