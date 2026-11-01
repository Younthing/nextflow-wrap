"use client";

import { OutputRenderer } from "@/features/output/output-renderer";
import { planMime } from "@/features/notebook/mime";
import { segmentsOf, type CellOutputModel } from "@/features/notebook/outputs";
import type { CellMimeBundle, CellOutput } from "@/features/notebook/types";
import { cn } from "@/lib/utils";

function RichBundle({ data }: { data: CellMimeBundle }) {
  return <OutputRenderer view={planMime(data)} />;
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
