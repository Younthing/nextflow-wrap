import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MarkdownView } from "@/features/notebook/components/markdown-view";
import { SafeHtml } from "@/features/notebook/components/safe-html";
import { cn } from "@/lib/utils";
import type { OutputView } from "./model";

/**
 * Renders one rich output. Notebook cell results and the run results pane
 * both use this, so png/svg/pdf, csv/tsv, Markdown, and HTML stay in one place.
 */
export function OutputRenderer({ view, className }: { view: OutputView; className?: string }) {
  if (view.kind === "html") {
    return (
      <div data-output="html" className={cn("text-sm", className)}>
        <SafeHtml nodes={view.nodes} />
      </div>
    );
  }
  if (view.kind === "html-document") {
    return (
      <iframe
        data-output="html"
        title={view.title}
        srcDoc={view.html}
        // Reports are untrusted output: no scripts or same-origin access.
        sandbox=""
        className={cn("min-h-64 w-full rounded-lg border border-border bg-white", className)}
      />
    );
  }
  if (view.kind === "image") {
    return (
      // Sources are data URLs or same-origin result files, not app assets.
      // eslint-disable-next-line @next/next/no-img-element
      <img data-output="image" data-mime={view.mime} src={view.src} alt={view.alt} className={cn("max-w-full", className)} />
    );
  }
  if (view.kind === "pdf") {
    return (
      <iframe
        data-output="pdf"
        title={view.title}
        src={view.src}
        className={cn("min-h-64 w-full rounded-lg border border-border bg-white", className)}
      />
    );
  }
  if (view.kind === "table") {
    return (
      <div data-output="table" className={cn("grid min-h-0 gap-2 overflow-auto", className)}>
        <div className="overflow-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                {view.columns.map((column, index) => (
                  <TableHead key={`${column}-${index}`}>{column}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.rows.map((row, rowIndex) => (
                <TableRow key={rowIndex}>
                  {view.columns.map((column, columnIndex) => (
                    <TableCell key={`${column}-${columnIndex}`} className="font-mono text-xs">
                      {row[columnIndex] ?? ""}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {view.truncated && (
          <p className="text-xs text-muted-foreground">仅显示前 {view.rows.length} 行</p>
        )}
      </div>
    );
  }
  if (view.kind === "markdown") {
    return (
      <div data-output="markdown" className={cn("min-h-0 overflow-auto text-sm", className)}>
        <MarkdownView source={view.source} />
      </div>
    );
  }
  if (view.kind === "text") {
    return (
      <pre data-output="text" className={cn("overflow-auto whitespace-pre-wrap font-mono text-xs text-muted-foreground", className)}>
        {view.text}
      </pre>
    );
  }
  return <p className="font-mono text-xs text-muted-foreground">（这个输出无法安全显示）</p>;
}
