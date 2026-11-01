"use client";

import { planMime } from "@/features/notebook/mime";
import { segmentsOf, type CellOutputModel } from "@/features/notebook/outputs";
import type { CellMimeBundle, CellOutput } from "@/features/notebook/types";
import { cn } from "@/lib/utils";
import { MarkdownView } from "./markdown-view";
import { SafeHtml } from "./safe-html";

function RichBundle({ data }: { data: CellMimeBundle }) {
  const plan = planMime(data);
  if (plan.kind === "html") {
    return (
      <div data-output="html" className="text-sm">
        <SafeHtml nodes={plan.nodes} />
      </div>
    );
  }
  if (plan.kind === "image") {
    return (
      // Cell images are generated data URLs.
      // eslint-disable-next-line @next/next/no-img-element
      <img data-output="image" data-mime={plan.mime} src={plan.src} alt={plan.alt} className="max-w-full" />
    );
  }
  if (plan.kind === "markdown") {
    return (
      <div data-output="markdown" className="text-sm">
        <MarkdownView source={plan.source} />
      </div>
    );
  }
  if (plan.kind === "text") {
    return (
      <pre data-output="text" className="overflow-auto whitespace-pre-wrap font-mono text-xs text-muted-foreground">
        {plan.text}
      </pre>
    );
  }
  return <p className="font-mono text-xs text-muted-foreground">（这个输出无法安全显示）</p>;
}

function OutputSegment({ segment }: { segment: CellOutput }) {
  if (segment.outputType === "stream") {
    return (
      <pre
        data-output={segment.name}
        className={cn(
          "overflow-auto whitespace-pre-wrap font-mono text-xs",
          segment.name === "stderr" ? "text-warning" : "text-muted-foreground",
        )}
      >
        {segment.text}
      </pre>
    );
  }
  if (segment.outputType === "error") {
    return (
      <pre role="alert" data-output="error" className="overflow-auto whitespace-pre-wrap font-mono text-xs text-destructive">
        {segment.traceback}
      </pre>
    );
  }
  return <RichBundle data={segment.data} />;
}

/** Stacks stdout, rich MIME results, and errors in execution order. */
export function CellOutputView({ output }: { output: CellOutputModel }) {
  const segments = segmentsOf(output);
  if (segments.length === 0) {
    return <div className="border-t border-border px-3 py-2 font-mono text-xs text-muted-foreground">（无输出）</div>;
  }
  return (
    <div className="grid gap-2 border-t border-border px-3 py-2">
      {segments.map((segment, index) => (
        <OutputSegment key={index} segment={segment} />
      ))}
    </div>
  );
}
