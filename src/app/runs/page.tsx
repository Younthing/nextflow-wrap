import type { Metadata } from "next";

import { RunsTable } from "@/features/runs/components/runs-table";

export const metadata: Metadata = { title: "运行记录" };

export default function RunsPage() {
  return (
    <section className="glass flex size-full flex-col gap-4 overflow-hidden rounded-xl p-5">
      <header>
        <h1 className="font-serif text-xl font-semibold">运行记录</h1>
        <p className="text-sm text-muted-foreground">从编辑器启动的每一次 nextflow run，运行中的状态会自动刷新。</p>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        <RunsTable />
      </div>
    </section>
  );
}
