import { searchModules } from "./catalog";
import { checkCompatibility, portSignature, socketInputs } from "./ports";
import type { ChannelElement, ModuleDef, PortDef } from "./types";

/** A dangling link that opened the node search on empty canvas. */
export interface PendingConnection {
  port: PortDef;
  side: "source" | "target";
}

export interface ModuleSearchHit {
  def: ModuleDef;
  /** Port on `def` that should connect to the pending link, when there is one. */
  port?: PortDef;
}

/**
 * Read inputs often ship without a glob, so the module leaves them
 * as untyped files. `checkCompatibility` then treats BAM and FastQ as the
 * same shape. When the description names FastQ and no other alignment
 * format, suggestions use that type. Stored formats are left alone.
 */
function formatForSuggestion(el: ChannelElement): string | undefined {
  if (el.kind !== "file") return undefined;
  if (el.format) return el.format;
  if (/\bfastq\b/i.test(el.description) && !/\b(bam|cram|sam)\b/i.test(el.description)) return "fastq";
  return undefined;
}

function portForSuggestion(port: PortDef): PortDef {
  let changed = false;
  const elements = port.elements.map((el) => {
    const format = formatForSuggestion(el);
    if (!format || format === el.format) return el;
    changed = true;
    return { ...el, format };
  });
  return changed ? { ...port, elements } : port;
}

function formatAgreement(source: PortDef, target: PortDef): number {
  let src = source.elements;
  const dst = target.elements;
  if (src[0]?.kind === "meta" && dst[0]?.kind !== "meta") src = src.slice(1);
  let agreed = 0;
  for (let i = 0; i < src.length && i < dst.length; i++) {
    const left = src[i];
    const right = dst[i];
    if (left.kind !== "file" && right.kind !== "file") continue;
    if (left.format && right.format && left.format === right.format) agreed += 1;
  }
  return agreed;
}

interface PortMatch {
  port: PortDef;
  agreement: number;
}

/** Best port on `def` for `pending`, preferring a real format agreement over an untyped file. */
function matchingPort(def: ModuleDef, pending: PendingConnection): PortMatch | undefined {
  const candidates = pending.side === "source" ? socketInputs(def) : def.outputs;
  let best: PortMatch | undefined;
  for (const candidate of candidates) {
    const source = pending.side === "source" ? pending.port : candidate;
    const target = pending.side === "source" ? candidate : pending.port;
    const typedSource = portForSuggestion(source);
    const typedTarget = portForSuggestion(target);
    const result = checkCompatibility(typedSource, typedTarget);
    if (!result.ok || result.warning) continue;
    const agreement = formatAgreement(typedSource, typedTarget);
    if (!best || agreement > best.agreement) best = { port: candidate, agreement };
  }
  return best;
}

/**
 * Modules for the node-search dialog.
 * A pending connection (dropped on empty canvas) keeps every query inside the
 * modules that can actually take that channel. An empty query lists format
 * agreements first, so a BAM output does not open on generic file inputs.
 * A typed query keeps text relevance, still inside that compatible set.
 */
export function modulesForSearch(
  modules: ModuleDef[],
  query: string,
  pending?: PendingConnection,
): ModuleSearchHit[] {
  const found = searchModules(modules, query);
  if (!pending) return found.map((def) => ({ def }));

  const hits = found.flatMap((def) => {
    const match = matchingPort(def, pending);
    return match ? [{ def, port: match.port, agreement: match.agreement }] : [];
  });
  if (!query.trim()) hits.sort((a, b) => b.agreement - a.agreement);
  return hits.map(({ def, port }) => ({ def, port }));
}

/** Empty-state copy. A pending link says that nothing can connect, not that the query missed. */
export function moduleSearchEmptyLabel(pending: PendingConnection | undefined, query: string): string {
  if (!pending) return "没有匹配的模块";
  const signature = `${pending.port.name} [${portSignature(pending.port)}]`;
  return query.trim() ? `没有能连接 ${signature} 的匹配模块` : `没有能连接 ${signature} 的模块`;
}
