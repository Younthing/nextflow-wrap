import {
  OUTPUT_MIME_ORDER,
  type CellMimeBundle,
  type CellOutput,
  type CellRunResult,
  type OutputMimeType,
} from "./types";

const MIME_KEYS = new Set<string>(OUTPUT_MIME_ORDER);
const MAX_TEXT = 100_000;
const MAX_RICH = 200_000;
const MAX_IMAGE = 2_000_000;

export interface CellOutputModel {
  stdout: string;
  error?: string;
  outputs?: CellOutput[];
}

function clip(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n…（已截断）`;
}

function normalizeBundle(value: unknown): CellMimeBundle | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const bundle: CellMimeBundle = {};
  for (const [key, item] of Object.entries(value)) {
    if (!MIME_KEYS.has(key) || typeof item !== "string" || item.length === 0) continue;
    const mime = key as OutputMimeType;
    const binary = (mime.startsWith("image/") && mime !== "image/svg+xml") || mime === "application/pdf";
    const limit = binary ? MAX_IMAGE : mime === "text/plain" ? MAX_TEXT : MAX_RICH;
    bundle[mime] = clip(item, limit);
  }
  return Object.keys(bundle).length > 0 ? bundle : undefined;
}

function normalizeOutput(value: unknown): CellOutput | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record.outputType === "stream" && (record.name === "stdout" || record.name === "stderr") && typeof record.text === "string") {
    return { outputType: "stream", name: record.name, text: clip(record.text, MAX_TEXT) };
  }
  if ((record.outputType === "display_data" || record.outputType === "execute_result")) {
    const data = normalizeBundle(record.data);
    if (!data) return undefined;
    return { outputType: record.outputType, data };
  }
  if (record.outputType === "error" && typeof record.traceback === "string" && record.traceback.trim()) {
    return { outputType: "error", traceback: clip(record.traceback, 12_000) };
  }
  return undefined;
}

export function normalizeOutputs(value: unknown): CellOutput[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const output = normalizeOutput(item);
    return output ? [output] : [];
  });
}

/** Fill stdout/error from ordered segments so older callers and the rich view stay in sync. */
export function finalizeCellResult(id: string, raw: { outputs?: unknown; error?: unknown }): CellRunResult {
  const outputs = normalizeOutputs(raw.outputs);
  const errorText = typeof raw.error === "string" && raw.error.trim() ? clip(raw.error, 12_000) : undefined;
  if (errorText && !outputs.some((item) => item.outputType === "error")) {
    outputs.push({ outputType: "error", traceback: errorText });
  }
  const stdout = outputs.flatMap((item) => item.outputType === "stream" && item.name === "stdout" ? [item.text] : []).join("");
  const error = outputs.find((item) => item.outputType === "error")?.traceback;
  return { id, stdout, error, outputs };
}

/** Segments to paint, including a legacy stdout/error pair that has no rich list yet. */
export function segmentsOf(output: CellOutputModel): CellOutput[] {
  const segments = output.outputs ? [...output.outputs] : [];
  if (segments.length === 0 && output.stdout) {
    segments.push({ outputType: "stream", name: "stdout", text: output.stdout });
  }
  if (output.error && !segments.some((item) => item.outputType === "error")) {
    segments.push({ outputType: "error", traceback: output.error });
  }
  return segments;
}
