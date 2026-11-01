import { parseFragment, type DefaultTreeAdapterMap } from "parse5";

import { safeImageUrl, safeLinkUrl } from "./images";

type Node = DefaultTreeAdapterMap["node"];
type ElementNode = DefaultTreeAdapterMap["element"];

const ALLOWED = new Set([
  "a", "b", "blockquote", "br", "caption", "code", "div", "em",
  "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "li",
  "ol", "p", "pre", "s", "span", "strong", "sub", "sup",
  "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul",
]);

/** Drop the element and everything inside it. */
const DROP = new Set([
  "script", "style", "iframe", "object", "embed", "link", "meta", "base",
  "noscript", "template", "svg", "math", "form", "input", "button",
  "textarea", "select", "video", "audio", "canvas", "applet", "frame", "frameset",
]);

const TABLE_STRUCTURE = new Set(["table", "thead", "tbody", "tfoot", "tr"]);

export type SafeTag =
  | "a" | "b" | "blockquote" | "br" | "caption" | "code" | "div" | "em"
  | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "hr" | "i" | "img" | "li"
  | "ol" | "p" | "pre" | "s" | "span" | "strong" | "sub" | "sup"
  | "table" | "tbody" | "td" | "tfoot" | "th" | "thead" | "tr" | "u" | "ul";

export interface SafeAttrs {
  href?: string;
  src?: string;
  alt?: string;
  colSpan?: number;
  rowSpan?: number;
}

export type SafeNode =
  | { kind: "text"; text: string }
  | { kind: "element"; tag: SafeTag; attrs: SafeAttrs; children: SafeNode[] };

function isElement(node: Node): node is ElementNode {
  return "tagName" in node && node.nodeName !== "#documentType";
}

function spanAttr(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  if (parsed < 1 || parsed > 100) return undefined;
  return parsed;
}

function attrsOf(element: ElementNode): SafeAttrs {
  const raw = Object.fromEntries(element.attrs.map((attr) => [attr.name.toLowerCase(), attr.value]));
  const attrs: SafeAttrs = {};
  if (element.tagName === "a") {
    const href = safeLinkUrl(raw.href ?? "");
    if (href) attrs.href = href;
  }
  if (element.tagName === "img") {
    const src = safeImageUrl(raw.src ?? "");
    if (src) attrs.src = src;
    attrs.alt = (raw.alt ?? "").slice(0, 200);
  }
  if (element.tagName === "td" || element.tagName === "th") {
    const colSpan = spanAttr(raw.colspan);
    const rowSpan = spanAttr(raw.rowspan);
    if (colSpan) attrs.colSpan = colSpan;
    if (rowSpan) attrs.rowSpan = rowSpan;
  }
  return attrs;
}

function walk(nodes: readonly Node[], parentTag: string | null): SafeNode[] {
  const result: SafeNode[] = [];
  for (const node of nodes) {
    if (node.nodeName === "#text" && "value" in node) {
      const text = node.value;
      if (!text) continue;
      if (parentTag && TABLE_STRUCTURE.has(parentTag) && !text.trim()) continue;
      result.push({ kind: "text", text });
      continue;
    }
    if (!isElement(node)) continue;
    const tag = node.tagName.toLowerCase();
    if (DROP.has(tag)) continue;
    const children = walk(node.childNodes, tag);
    if (!ALLOWED.has(tag)) {
      result.push(...children);
      continue;
    }
    if (tag === "img") {
      const attrs = attrsOf(node);
      if (!attrs.src) {
        if (attrs.alt) result.push({ kind: "text", text: attrs.alt });
        continue;
      }
      result.push({ kind: "element", tag: "img", attrs, children: [] });
      continue;
    }
    const safeTag = tag as SafeTag;
    const attrs = attrsOf(node);
    if (safeTag === "a" && !attrs.href) {
      result.push(...children);
      continue;
    }
    result.push({ kind: "element", tag: safeTag, attrs, children });
  }
  return result;
}

/** Parse an HTML fragment into an allow-listed tree. Scripts, handlers, and styles are removed. */
export function sanitizeHtml(source: string): SafeNode[] {
  if (!source.trim()) return [];
  const fragment = parseFragment(source);
  return walk(fragment.childNodes, null);
}

export function htmlHasContent(nodes: readonly SafeNode[]): boolean {
  return nodes.some((node) => {
    if (node.kind === "text") return node.text.trim().length > 0;
    if (node.tag === "img") return Boolean(node.attrs.src);
    if (node.tag === "br" || node.tag === "hr") return true;
    return htmlHasContent(node.children);
  });
}
