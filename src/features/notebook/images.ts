const MAX_IMAGE_CHARS = 2_000_000;
const MAX_SVG_CHARS = 200_000;

const DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,([a-z0-9+/=]+)$/i;

function compactBase64(value: string): string | undefined {
  const compact = value.replace(/\s/g, "");
  if (!compact || compact.length > MAX_IMAGE_CHARS) return undefined;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return undefined;
  return compact;
}

function magicOk(mime: "image/png" | "image/jpeg" | "image/gif" | "image/webp", payload: string): boolean {
  if (mime === "image/png") return payload.startsWith("iVBORw0KGgo");
  if (mime === "image/jpeg") return payload.startsWith("/9j/");
  if (mime === "image/gif") return payload.startsWith("R0lGOD");
  return payload.startsWith("UklGR");
}

/** A raster data URL, or undefined when the payload is not a real image. */
export function imageMimeDataUrl(
  mime: "image/png" | "image/jpeg" | "image/gif" | "image/webp",
  payload: string,
): string | undefined {
  const compact = compactBase64(payload);
  if (!compact || !magicOk(mime, compact)) return undefined;
  return `data:${mime};base64,${compact}`;
}

/** SVG as an inert image URL. Scripts and event handlers are rejected. */
export function svgMarkupToDataUrl(svg: string): string | undefined {
  const trimmed = svg.trim();
  if (!trimmed || trimmed.length > MAX_SVG_CHARS) return undefined;
  if (!/<svg[\s>/]/i.test(trimmed)) return undefined;
  if (/<script|<\/script|javascript:|on[a-z]+\s*=|<foreignObject|<iframe|<embed|<object/i.test(trimmed)) return undefined;
  return `data:image/svg+xml,${encodeURIComponent(trimmed)}`;
}

/** http(s) image or a checked data-image URL. Anything else is dropped. */
export function safeImageUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    if (trimmed.length > 2_000 || /[\s<>]/.test(trimmed)) return undefined;
    return trimmed;
  }
  const data = DATA_IMAGE.exec(trimmed.replace(/\s/g, ""));
  if (!data) return undefined;
  const subtype = data[1].toLowerCase() as "png" | "jpeg" | "gif" | "webp";
  return imageMimeDataUrl(`image/${subtype}`, data[2]);
}

/** Link destinations for markdown and HTML. Remote http(s), mailto, and in-page anchors only. */
export function safeLinkUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    if (trimmed.length > 2_000 || /[\s<>]/.test(trimmed)) return undefined;
    return trimmed;
  }
  if (/^mailto:[^\s<>]+$/i.test(trimmed) && trimmed.length < 500) return trimmed;
  if (trimmed.startsWith("#") && !trimmed.includes(":") && trimmed.length < 200) return trimmed;
  return undefined;
}
