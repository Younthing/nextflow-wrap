"use client";

import * as React from "react";
import { FileCode2, FileJson, FileText, Folder } from "lucide-react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { ProjectFile } from "../generate";
import { CodeViewer } from "./code-viewer";

const languageOf = (path: string): ProjectFile["language"] => {
  if (/\.(nf|config)$/.test(path)) return "groovy";
  if (path.endsWith(".json")) return "json";
  if (/\.ya?ml$/.test(path)) return "yaml";
  if (path.endsWith(".csv")) return "csv";
  if (path.endsWith(".md")) return "markdown";
  return "text";
};

function FileIcon({ path }: { path: string }) {
  const lang = languageOf(path);
  const Icon =
    lang === "groovy" ? FileCode2 : lang === "json" ? FileJson : FileText;
  return <Icon className="size-3.5 shrink-0 text-muted-foreground" />;
}

/** Files sorted like a tree: directories first, then by path. */
function treeRows(files: { path: string }[]) {
  const sorted = [...files].sort((a, b) => {
    const da = a.path.includes("/") ? 0 : 1;
    const db = b.path.includes("/") ? 0 : 1;
    return da - db || a.path.localeCompare(b.path);
  });
  const rows: (
    | { kind: "dir"; path: string; depth: number }
    | { kind: "file"; path: string; depth: number }
  )[] = [];
  const seen = new Set<string>();
  for (const f of sorted) {
    const parts = f.path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/");
      if (!seen.has(dir)) {
        seen.add(dir);
        rows.push({ kind: "dir", path: dir, depth: i - 1 });
      }
    }
    rows.push({ kind: "file", path: f.path, depth: parts.length - 1 });
  }
  return rows;
}

export function ProjectPreview({
  files,
  initialPath = "main.nf",
  className,
}: {
  files: {
    path: string;
    content: string;
    language?: ProjectFile["language"];
  }[];
  initialPath?: string;
  className?: string;
}) {
  const [selected, setSelected] = React.useState(initialPath);
  const file = files.find((f) => f.path === selected) ?? files[0];
  const rows = React.useMemo(() => treeRows(files), [files]);

  return (
    <div className={cn("flex min-h-0 gap-3", className)}>
      <ScrollArea className="w-60 shrink-0 rounded-lg bg-secondary/40">
        <ul className="p-1.5 text-xs" aria-label="项目文件">
          {rows.map((row) =>
            row.kind === "dir" ? (
              <li
                key={`d:${row.path}`}
                className="flex items-center gap-1.5 px-2 py-1 text-muted-foreground"
                style={{ paddingLeft: 8 + row.depth * 12 }}
              >
                <Folder className="size-3.5 shrink-0" />
                {row.path.split("/").pop()}/
              </li>
            ) : (
              <li key={row.path}>
                <button
                  type="button"
                  aria-pressed={row.path === file?.path}
                  onClick={() => setSelected(row.path)}
                  className={cn(
                    "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left font-mono hover:bg-accent",
                    row.path === file?.path &&
                      "bg-glass-strong text-primary shadow-sm",
                  )}
                  style={{ paddingLeft: 8 + row.depth * 12 }}
                >
                  <FileIcon path={row.path} />
                  <span className="truncate">{row.path.split("/").pop()}</span>
                </button>
              </li>
            ),
          )}
        </ul>
      </ScrollArea>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {file && (
          <>
            <div className="font-mono text-xs text-muted-foreground">
              {file.path}
            </div>
            <CodeViewer
              code={file.content}
              language={file.language ?? languageOf(file.path)}
              className="min-h-0 flex-1"
            />
          </>
        )}
      </div>
    </div>
  );
}
