"use client";

import * as React from "react";
import { FolderOpen, PackageOpen } from "lucide-react";

import { AsyncPlaceholder } from "@/components/ui/async-placeholder";
import { OutputRenderer } from "@/features/output/output-renderer";
import { viewFromText, type OutputView } from "@/features/output/model";
import { formatBytes } from "../format";
import { imageMime, isBinaryPreview, type ResultPreview } from "../preview";
import { useAnnDataSummaryAt, useFileBlob, useFileText } from "../queries";
import { staticReportHtml } from "../report-preview";
import { AnnDataSummaryView } from "./anndata-summary";
import { MoleculeViewer } from "./molecule-viewer";

/** Where a previewed file is read from: a run's results, or a project's folder. */
export interface PreviewSource {
  /** Query key prefix the cached content lives under. */
  key: readonly unknown[];
  contentUrl: (path: string) => string;
  summaryUrl: (path: string) => string;
}

/** A file to preview. `path` is what the source reads it by; directories end in `/`. */
export interface PreviewFile {
  path: string;
  size: number;
  preview: ResultPreview;
}

function BlobPreview({ blob, view }: { blob: Blob; view: (src: string) => OutputView }) {
  const src = React.useMemo(() => URL.createObjectURL(blob), [blob]);
  React.useEffect(() => () => URL.revokeObjectURL(src), [src]);
  return <OutputRenderer view={view(src)} className="min-h-0 flex-1" />;
}

/**
 * Opens one file the way the run results page does: HTML reports (static), Markdown, tables, text, images, PDFs,
 * 3D structures and `.h5ad` summaries. Other files show their size.
 */
export function FilePreview({ source, file, fullPath }: { source: PreviewSource; file: PreviewFile; fullPath: string }) {
  const binary = isBinaryPreview(file.preview);
  const textual = file.preview === "html" || file.preview === "markdown" || file.preview === "csv" || file.preview === "tsv" || file.preview === "text" || file.preview === "molecule";
  const content = useFileText(source.key, textual ? source.contentUrl(file.path) : null);
  const summary = useAnnDataSummaryAt(source.key, file.preview === "anndata" ? source.summaryUrl(file.path) : null);
  const blob = useFileBlob(source.key, binary ? source.contentUrl(file.path) : null);
  const reportHtml = React.useMemo(
    () => (file.preview === "html" && content.data ? staticReportHtml(content.data.body) : ""),
    [file.preview, content.data],
  );

  if (!file.preview) {
    if (file.path.endsWith("/")) {
      return (
        <AsyncPlaceholder status="empty" className="flex-1" icon={<FolderOpen />} description="目录">
          <code className="rounded bg-secondary px-2 py-1 font-mono text-xs">{fullPath}</code>
        </AsyncPlaceholder>
      );
    }
    return (
      <AsyncPlaceholder status="empty" className="flex-1" icon={<PackageOpen />} description={`无法预览的文件 · ${formatBytes(file.size)}`}>
        <code className="rounded bg-secondary px-2 py-1 font-mono text-xs">{fullPath}</code>
      </AsyncPlaceholder>
    );
  }
  if (file.preview === "anndata") {
    if (summary.isPending) return <AsyncPlaceholder status="pending" className="flex-1" />;
    if (summary.error) return <AsyncPlaceholder status="error" className="h-auto" message={`无法读取摘要：${summary.error.message}`} />;
    return <AnnDataSummaryView summary={summary.data} />;
  }
  const pending = binary ? blob.isPending : content.isPending;
  const error = binary ? blob.error : content.error;
  if (pending) return <AsyncPlaceholder status="pending" className="flex-1" />;
  if (error) return <AsyncPlaceholder status="error" className="h-auto" message={`读取失败：${error.message}`} />;
  if (binary && blob.data) {
    const mime = imageMime(file.preview);
    return (
      <BlobPreview
        blob={blob.data}
        view={(src) => mime
          ? { kind: "image", mime, src, alt: file.path }
          : { kind: "pdf", src, title: file.path }}
      />
    );
  }
  if (!content.data) return <AsyncPlaceholder status="pending" className="flex-1" />;
  if (file.preview === "html") {
    return <OutputRenderer view={{ kind: "html-document", html: reportHtml, title: file.path }} className="min-h-0 flex-1" />;
  }
  if (file.preview === "molecule") return <MoleculeViewer path={file.path} text={content.data.body} />;
  if (file.preview === "markdown" || file.preview === "csv" || file.preview === "tsv" || file.preview === "text") {
    return <OutputRenderer view={viewFromText(file.preview, content.data.body)} className="min-h-0 flex-1" />;
  }
  return <AsyncPlaceholder status="pending" className="flex-1" />;
}
