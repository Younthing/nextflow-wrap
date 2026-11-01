"use client";

import type { ComponentProps, JSX } from "react";
import ReactMarkdown, { type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { safeImageUrl, safeLinkUrl } from "@/features/notebook/images";
import { cn } from "@/lib/utils";

type MarkdownProps<T extends keyof JSX.IntrinsicElements> = ComponentProps<T> & ExtraProps;

function omitNode<T extends { node?: unknown }>(props: T): Omit<T, "node"> {
  const rest = { ...props };
  delete rest.node;
  return rest;
}

const markdownComponents = {
  h1: ({ node, ...props }: MarkdownProps<"h1">) => <h1 {...omitNode({ node, ...props })} className="text-lg font-semibold" />,
  h2: ({ node, ...props }: MarkdownProps<"h2">) => <h2 {...omitNode({ node, ...props })} className="text-base font-semibold" />,
  h3: ({ node, ...props }: MarkdownProps<"h3">) => <h3 {...omitNode({ node, ...props })} className="text-sm font-semibold" />,
  h4: ({ node, ...props }: MarkdownProps<"h4">) => <h4 {...omitNode({ node, ...props })} className="text-sm font-medium" />,
  h5: ({ node, ...props }: MarkdownProps<"h5">) => <h5 {...omitNode({ node, ...props })} className="text-sm font-medium" />,
  h6: ({ node, ...props }: MarkdownProps<"h6">) => <h6 {...omitNode({ node, ...props })} className="text-xs font-medium" />,
  p: ({ node, ...props }: MarkdownProps<"p">) => <p {...omitNode({ node, ...props })} />,
  ul: ({ node, ...props }: MarkdownProps<"ul">) => <ul {...omitNode({ node, ...props })} className="list-disc space-y-1 pl-5" />,
  ol: ({ node, ...props }: MarkdownProps<"ol">) => <ol {...omitNode({ node, ...props })} className="list-decimal space-y-1 pl-5" />,
  li: ({ node, ...props }: MarkdownProps<"li">) => <li {...omitNode({ node, ...props })} />,
  blockquote: ({ node, ...props }: MarkdownProps<"blockquote">) => (
    <blockquote {...omitNode({ node, ...props })} className="border-l-2 border-border pl-3 text-muted-foreground" />
  ),
  pre: ({ node, ...props }: MarkdownProps<"pre">) => (
    <pre {...omitNode({ node, ...props })} className="overflow-auto rounded-md bg-muted px-3 py-2 font-mono text-xs [&_code]:bg-transparent [&_code]:p-0" />
  ),
  code: ({ node, ...props }: MarkdownProps<"code">) => (
    <code {...omitNode({ node, ...props })} className={cn("rounded bg-muted px-1 font-mono text-[0.85em]", props.className)} />
  ),
  a: ({ node, href, children, ...props }: MarkdownProps<"a">) => {
    const safe = href ? safeLinkUrl(href) : undefined;
    if (!safe || safe.startsWith("#")) return <span {...omitNode({ node, ...props })}>{children}</span>;
    return (
      <a {...omitNode({ node, ...props })} href={safe} target="_blank" rel="noreferrer noopener" className="text-primary underline underline-offset-4">
        {children}
      </a>
    );
  },
  img: ({ node, src, alt, ...props }: MarkdownProps<"img">) => {
    const safe = typeof src === "string" ? safeImageUrl(src) : undefined;
    if (!safe) return <span>{alt ?? ""}</span>;
    return (
      // Inline notebook images are user-authored URLs, not app assets.
      // eslint-disable-next-line @next/next/no-img-element
      <img {...omitNode({ node, ...props })} src={safe} alt={alt ?? ""} className="max-w-full" />
    );
  },
  table: ({ node, ...props }: MarkdownProps<"table">) => (
    <div className="overflow-auto rounded-md border border-border">
      <Table {...omitNode({ node, ...props })} />
    </div>
  ),
  thead: ({ node, ...props }: MarkdownProps<"thead">) => <TableHeader {...omitNode({ node, ...props })} />,
  tbody: ({ node, ...props }: MarkdownProps<"tbody">) => <TableBody {...omitNode({ node, ...props })} />,
  tr: ({ node, ...props }: MarkdownProps<"tr">) => <TableRow {...omitNode({ node, ...props })} />,
  th: ({ node, ...props }: MarkdownProps<"th">) => <TableHead {...omitNode({ node, ...props })} />,
  td: ({ node, ...props }: MarkdownProps<"td">) => <TableCell {...omitNode({ node, ...props })} />,
  hr: ({ node, ...props }: MarkdownProps<"hr">) => <hr {...omitNode({ node, ...props })} className="border-border" />,
  input: ({ node, ...props }: MarkdownProps<"input">) => (
    <input {...omitNode({ node, ...props })} disabled className="mr-1 align-middle" />
  ),
};

function transformUrl(url: string): string {
  return safeLinkUrl(url) ?? safeImageUrl(url) ?? "";
}

/** GFM markdown. Raw HTML stays text. Links and images only keep safe URLs. */
export function MarkdownView({ source, className }: { source: string; className?: string }) {
  return (
    <div className={cn("grid gap-2 text-sm leading-6", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents} urlTransform={transformUrl}>
        {source}
      </ReactMarkdown>
    </div>
  );
}
