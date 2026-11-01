import { htmlHasContent, sanitizeHtml, type SafeNode } from "./html-sanitize";
import { imageMimeDataUrl, svgMarkupToDataUrl } from "./images";
import { OUTPUT_MIME_ORDER, type CellMimeBundle, type OutputMimeType } from "./types";

export type MimePlan =
  | { kind: "html"; nodes: SafeNode[] }
  | { kind: "image"; mime: "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/svg+xml"; src: string; alt: string }
  | { kind: "markdown"; source: string }
  | { kind: "text"; text: string }
  | { kind: "empty" };

function imageAlt(data: CellMimeBundle): string {
  const plain = data["text/plain"]?.replace(/\s+/g, " ").trim();
  if (plain && plain.length <= 120) return plain;
  return "图像输出";
}

function raster(mime: "image/png" | "image/jpeg" | "image/gif" | "image/webp", value: string, data: CellMimeBundle): MimePlan | undefined {
  const src = imageMimeDataUrl(mime, value);
  if (!src) return undefined;
  return { kind: "image", mime, src, alt: imageAlt(data) };
}

/**
 * Pick the single best MIME in a bundle.
 * HTML wins over images, images win over markdown and plain text.
 * An HTML payload that sanitizes to nothing falls through.
 */
export function planMime(data: CellMimeBundle): MimePlan {
  for (const mime of OUTPUT_MIME_ORDER) {
    const value = data[mime];
    if (typeof value !== "string" || value.length === 0) continue;
    const plan = planOne(mime, value, data);
    if (plan) return plan;
  }
  return { kind: "empty" };
}

function planOne(mime: OutputMimeType, value: string, data: CellMimeBundle): MimePlan | undefined {
  if (mime === "text/html") {
    const nodes = sanitizeHtml(value);
    if (htmlHasContent(nodes)) return { kind: "html", nodes };
    return undefined;
  }
  if (mime === "image/svg+xml") {
    const src = svgMarkupToDataUrl(value);
    if (!src) return undefined;
    return { kind: "image", mime, src, alt: imageAlt(data) };
  }
  if (mime === "image/png" || mime === "image/jpeg" || mime === "image/gif" || mime === "image/webp") {
    return raster(mime, value, data);
  }
  if (mime === "text/markdown") {
    if (!value.trim()) return undefined;
    return { kind: "markdown", source: value };
  }
  return { kind: "text", text: value };
}
