"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, NotebookText, Plus } from "lucide-react";

import { AsyncPlaceholder } from "@/components/ui/async-placeholder";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { filterNotebooks, formatRelative, type NotebookFilter } from "@/features/notebook/library";
import { useCreateNotebook, useNotebooks } from "@/features/notebook/queries";
import { kernelLabel } from "@/features/notebook/types";
import { cn } from "@/lib/utils";

const FILTERS: { id: NotebookFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "analysis", label: "仅分析" },
  { id: "published", label: "已发布为模块" },
];

export function NotebookList() {
  const router = useRouter();
  const notebooks = useNotebooks();
  const create = useCreateNotebook();
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<NotebookFilter>("all");
  const rows = notebooks.data;
  const visible = React.useMemo(() => filterNotebooks(rows ?? [], filter, query), [rows, filter, query]);
  const list = rows ?? [];
  const counts = {
    all: list.length,
    analysis: list.filter((row) => row.publishState === "analysis").length,
    published: list.filter((row) => row.publishState === "published").length,
  };

  const onCreate = () => {
    create.mutate(
      {
        name: "未命名笔记本",
        description: "",
        kernel: "py311-pandas",
        cells: [{ id: "c1", role: "code", source: "" }],
      },
      { onSuccess: (doc) => router.push(`/notebooks/${doc.id}`) },
    );
  };

  return (
    <section className="glass flex size-full flex-col gap-4 overflow-hidden rounded-xl p-5">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="font-serif text-xl font-semibold">笔记本</h1>
          <p className="mt-1 text-sm text-muted-foreground">自由分析的地方。想复用到流程里时，再「发布为模块」。</p>
        </div>
        <Button type="button" onClick={onCreate} disabled={create.isPending}>
          {create.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
          新建笔记本
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((item) => (
          <Button
            key={item.id}
            type="button"
            size="sm"
            variant={filter === item.id ? "secondary" : "ghost"}
            onClick={() => setFilter(item.id)}
          >
            {item.label} · {counts[item.id]}
          </Button>
        ))}
        <div className="min-w-48 flex-1">
          <SearchField value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索笔记本" aria-label="搜索笔记本" />
        </div>
      </div>

      {create.error && <p role="alert" className="text-sm text-destructive">{create.error.message}</p>}

      <div className="min-h-0 flex-1 overflow-auto">
        {notebooks.isPending ? (
          <AsyncPlaceholder status="pending" className="h-40" />
        ) : notebooks.error ? (
          <AsyncPlaceholder status="error" className="h-auto" message={`加载笔记本失败：${notebooks.error.message}`} />
        ) : list.length === 0 ? (
          <AsyncPlaceholder status="empty" className="h-60" icon={<NotebookText />} description="还没有笔记本">
            <Button type="button" variant="outline" size="sm" onClick={onCreate}><Plus /> 新建笔记本</Button>
          </AsyncPlaceholder>
        ) : visible.length === 0 ? (
          <AsyncPlaceholder status="empty" className="h-40" description="没有匹配的笔记本" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>笔记本</TableHead>
                <TableHead>内核环境</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>对应模块</TableHead>
                <TableHead>更新</TableHead>
                <TableHead className="text-right"><span className="sr-only">操作</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="max-w-72">
                    <Link href={`/notebooks/${row.id}`} className="block truncate font-medium text-primary hover:underline">{row.name}</Link>
                    {row.description && <div className="truncate text-xs text-muted-foreground">{row.description}</div>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">{row.kernel}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {row.publishState === "analysis" ? (
                        <Badge variant="secondary">仅分析</Badge>
                      ) : (
                        <Badge variant={row.tryRun === "failed" ? "outline" : "success"}>已发布为模块 · {row.publishedVersion}</Badge>
                      )}
                      {row.tryRun === "failed" && <Badge variant="destructive">试跑失败</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{row.moduleName ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground" title={kernelLabel(row.kernel)}>
                    {formatRelative(row.updatedAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/notebooks/${row.id}`}>打开</Link>
                      </Button>
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/notebooks/${row.id}/publish?step=1`} className={cn(row.publishState === "analysis" && "font-normal")}>
                          {row.publishState === "published" ? "发布新版本" : "发布为模块"}
                        </Link>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        大多数笔记本停在「仅分析」即可；发布后生成独立的模块，笔记本继续可以改，不影响已发布版本。已发布模块的台账在{" "}
        <Link href="/workflows/modules" className="text-primary hover:underline">流程 / 模块库</Link>。
      </p>
    </section>
  );
}
