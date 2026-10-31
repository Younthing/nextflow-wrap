import { cn } from "@/lib/utils";

import type { ProjectFile } from "../generate";
import { CodeViewer } from "./code-viewer";

type Language = ProjectFile["language"];

export function LabeledCode({
  title,
  code,
  language,
  lineNumbers,
  className,
}: {
  title: string;
  code: string;
  language: Language;
  lineNumbers?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <span className="text-xs font-semibold text-muted-foreground">{title}</span>
      <CodeViewer code={code} language={language} lineNumbers={lineNumbers} />
    </div>
  );
}
