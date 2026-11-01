"use client";

import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { AnnDataColumn, AnnDataSummary } from "../anndata";

const count = (n: number) => n.toLocaleString("zh-CN");

function Columns({ title, columns }: { title: string; columns: AnnDataColumn[] }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title} · {columns.length} 列</h3>
      {columns.length ? (
        <ul className="divide-y divide-border/60 rounded-md border border-border/60">
          {columns.map((column) => (
            <li key={column.name} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-1.5 text-sm">
              <code className="font-mono">{column.name}</code>
              <span className="text-xs text-muted-foreground">{column.dtype}{column.categoryCount ? ` · ${column.categoryCount} 类` : ""}</span>
              {column.categories?.length ? (
                <span className="truncate text-xs text-muted-foreground">
                  {column.categories.join("、")}{column.categoryCount && column.categoryCount > column.categories.length ? "…" : ""}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted-foreground">无</p>}
    </section>
  );
}

/** What is inside an `.h5ad` file without loading it: shape, obs/var columns, embeddings, layers and uns keys. */
export function AnnDataSummaryView({ summary }: { summary: AnnDataSummary }) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="space-y-5 p-4">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <p className="text-2xl font-semibold tabular-nums">{count(summary.nObs)} <span className="text-sm font-normal text-muted-foreground">个细胞（obs）</span></p>
          <p className="text-2xl font-semibold tabular-nums">{count(summary.nVars)} <span className="text-sm font-normal text-muted-foreground">个基因（var）</span></p>
          <Badge variant="secondary" className="font-mono">X: {summary.matrix}</Badge>
        </div>
        {summary.obsm.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">嵌入（obsm）</h3>
            <div className="flex flex-wrap gap-2">
              {summary.obsm.map((item) => (
                <Badge key={item.name} variant="outline" className="font-mono">{item.name} {item.shape.join(" × ")}</Badge>
              ))}
            </div>
          </section>
        )}
        <div className="grid gap-5 lg:grid-cols-2">
          <Columns title="obs" columns={summary.obs} />
          <Columns title="var" columns={summary.var} />
        </div>
        <div className="grid gap-5 text-sm lg:grid-cols-2">
          <section className="space-y-1">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">layers</h3>
            <p className="font-mono">{summary.layers.join("、") || "无"}</p>
          </section>
          <section className="space-y-1">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">uns</h3>
            <p className="font-mono">{summary.uns.join("、") || "无"}</p>
          </section>
        </div>
        <p className="text-xs text-muted-foreground">
          obs_names：<span className="font-mono">{summary.obsNames.join(", ")}</span>
          {" · "}var_names：<span className="font-mono">{summary.varNames.join(", ")}</span>
        </p>
      </div>
    </ScrollArea>
  );
}
