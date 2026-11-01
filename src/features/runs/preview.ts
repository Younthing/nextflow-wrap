import type { ImageMime } from "@/features/output/model";

/** How a result file can be opened. `null` is a directory or an opaque file. */
export type ResultPreview =
  | "html"
  | "markdown"
  | "csv"
  | "tsv"
  | "png"
  | "jpeg"
  | "gif"
  | "webp"
  | "svg"
  | "pdf"
  | "text"
  /** `.h5ad`: summarised on the server (shape, obs/var columns, embeddings), never sent to the browser. */
  | "anndata"
  /** Structures and poses (PDB, PDBQT, SDF, MOL2, mmCIF), shown in a Mol* 3D view. */
  | "molecule"
  | null;

const TEXT_EXT = /\.(txt|log|json|ya?ml|out|summary|flagstat|stats|metrics|gtf)$/i;

/** Preview kind from a result path. Directories and unknown binaries stay closed. */
export function previewKind(path: string): ResultPreview {
  if (!path || path.endsWith("/")) return null;
  if (/\.html?$/i.test(path)) return "html";
  if (/\.(md|markdown)$/i.test(path)) return "markdown";
  if (/\.csv$/i.test(path)) return "csv";
  if (/\.tsv$/i.test(path)) return "tsv";
  if (/\.png$/i.test(path)) return "png";
  if (/\.jpe?g$/i.test(path)) return "jpeg";
  if (/\.gif$/i.test(path)) return "gif";
  if (/\.webp$/i.test(path)) return "webp";
  if (/\.svg$/i.test(path)) return "svg";
  if (/\.pdf$/i.test(path)) return "pdf";
  if (/\.h5ad$/i.test(path)) return "anndata";
  if (MOLECULE_EXT.test(path)) return "molecule";
  if (TEXT_EXT.test(path)) return "text";
  return null;
}

const MOLECULE_EXT = /\.(pdb|ent|pdbqt|sdf|mol|mol2|cif|mmcif)$/i;
export const PREVIEW_MAX_BYTES = 10 * 1024 ** 2;

/** Preview kind for a file of a known size. A large file cannot be opened inline, but an AnnData summary reads only metadata. */
export function previewFor(path: string, size: number): ResultPreview {
  const kind = previewKind(path);
  return size > PREVIEW_MAX_BYTES && kind !== "anndata" ? null : kind;
}

/** Mol* trajectory format for a structure file. */
export function moleculeFormat(path: string): "pdb" | "pdbqt" | "sdf" | "mol" | "mol2" | "mmcif" | undefined {
  const ext = path.toLowerCase().split(".").at(-1);
  if (ext === "pdb" || ext === "ent") return "pdb";
  if (ext === "pdbqt" || ext === "sdf" || ext === "mol" || ext === "mol2") return ext;
  if (ext === "cif" || ext === "mmcif") return "mmcif";
  return undefined;
}

export function imageMime(preview: ResultPreview): ImageMime | undefined {
  if (preview === "png") return "image/png";
  if (preview === "jpeg") return "image/jpeg";
  if (preview === "gif") return "image/gif";
  if (preview === "webp") return "image/webp";
  if (preview === "svg") return "image/svg+xml";
  return undefined;
}

export function isBinaryPreview(preview: ResultPreview): boolean {
  return preview === "pdf" || imageMime(preview) !== undefined;
}

/** The first file the results pane can open, in list order. */
export function firstPreviewable<T extends { preview: ResultPreview }>(files: readonly T[]): T | undefined {
  return files.find((file) => file.preview != null);
}

export function contentTypeOf(path: string): string {
  switch (previewKind(path)) {
    case "html":
      return "text/html";
    case "markdown":
      return "text/markdown";
    case "csv":
      return "text/csv";
    case "tsv":
      return "text/tab-separated-values";
    case "png":
      return "image/png";
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "pdf":
      return "application/pdf";
    case "molecule":
      return "text/plain";
    case "anndata":
      return "application/x-hdf5";
    case "text":
      return /\.json$/i.test(path) ? "application/json" : "text/plain";
    default:
      return "application/octet-stream";
  }
}
