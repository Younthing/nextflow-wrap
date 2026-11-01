"use client";

import type { ReactNode } from "react";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { SafeNode } from "@/features/notebook/html-sanitize";
import { cn } from "@/lib/utils";

function renderNodes(nodes: readonly SafeNode[], keyPrefix: string, section: "head" | "body" | "foot" | null): ReactNode[] {
  return nodes.map((node, index) => renderNode(node, `${keyPrefix}-${index}`, section));
}

function renderNode(node: SafeNode, key: string, section: "head" | "body" | "foot" | null): ReactNode {
  if (node.kind === "text") return node.text;
  const children = renderNodes(node.children, key, nextSection(node.tag, section));
  const span = {
    ...(node.attrs.colSpan ? { colSpan: node.attrs.colSpan } : {}),
    ...(node.attrs.rowSpan ? { rowSpan: node.attrs.rowSpan } : {}),
  };
  switch (node.tag) {
    case "table":
      return (
        <div key={key} className="overflow-auto rounded-md border border-border">
          <Table>{children}</Table>
        </div>
      );
    case "thead":
      return <TableHeader key={key}>{children}</TableHeader>;
    case "tbody":
      return <TableBody key={key}>{children}</TableBody>;
    case "tfoot":
      return <tfoot key={key}>{children}</tfoot>;
    case "tr":
      return <TableRow key={key}>{children}</TableRow>;
    case "th":
      return (
        <TableHead key={key} scope={section === "body" || section === "foot" ? "row" : "col"} {...span}>
          {children}
        </TableHead>
      );
    case "td":
      return <TableCell key={key} {...span}>{children}</TableCell>;
    case "caption":
      return <caption key={key} className="px-3 py-2 text-left text-xs text-muted-foreground">{children}</caption>;
    case "a":
      return (
        <a key={key} href={node.attrs.href} target="_blank" rel="noreferrer noopener" className="text-primary underline underline-offset-4">
          {children}
        </a>
      );
    case "img":
      return (
        // Notebook HTML images are data URLs or remote user content, not optimizer assets.
        // eslint-disable-next-line @next/next/no-img-element
        <img key={key} src={node.attrs.src} alt={node.attrs.alt ?? ""} className="max-w-full" />
      );
    case "pre":
      return <pre key={key} className="overflow-auto rounded-md bg-muted px-3 py-2 font-mono text-xs">{children}</pre>;
    case "code":
      return <code key={key} className="rounded bg-muted px-1 font-mono text-[0.85em]">{children}</code>;
    case "ul":
      return <ul key={key} className="list-disc space-y-1 pl-5">{children}</ul>;
    case "ol":
      return <ol key={key} className="list-decimal space-y-1 pl-5">{children}</ol>;
    case "blockquote":
      return <blockquote key={key} className="border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>;
    case "h1":
      return <h1 key={key} className="text-lg font-semibold">{children}</h1>;
    case "h2":
      return <h2 key={key} className="text-base font-semibold">{children}</h2>;
    case "h3":
      return <h3 key={key} className="text-sm font-semibold">{children}</h3>;
    case "h4":
      return <h4 key={key} className="text-sm font-medium">{children}</h4>;
    case "h5":
      return <h5 key={key} className="text-xs font-medium">{children}</h5>;
    case "h6":
      return <h6 key={key} className="text-xs font-medium">{children}</h6>;
    case "p":
      return <p key={key}>{children}</p>;
    case "br":
      return <br key={key} />;
    case "hr":
      return <hr key={key} className="border-border" />;
    case "strong":
    case "b":
      return <strong key={key}>{children}</strong>;
    case "em":
    case "i":
      return <em key={key}>{children}</em>;
    case "s":
      return <s key={key}>{children}</s>;
    case "sub":
      return <sub key={key}>{children}</sub>;
    case "sup":
      return <sup key={key}>{children}</sup>;
    case "li":
      return <li key={key}>{children}</li>;
    default:
      return <span key={key} className={cn(node.tag === "div" && "block")}>{children}</span>;
  }
}

function nextSection(tag: string, section: "head" | "body" | "foot" | null): "head" | "body" | "foot" | null {
  if (tag === "thead") return "head";
  if (tag === "tbody") return "body";
  if (tag === "tfoot") return "foot";
  return section;
}

export function SafeHtml({ nodes }: { nodes: readonly SafeNode[] }) {
  return <>{renderNodes(nodes, "html", null)}</>;
}
