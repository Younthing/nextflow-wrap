import { RunsTable } from "./runs-table";

export function RunsBrowse() {
  return (
    <section className="glass flex size-full flex-col gap-4 overflow-hidden rounded-xl p-5">
      <header>
        <h1 className="font-serif text-xl font-semibold">运行记录</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        <RunsTable />
      </div>
    </section>
  );
}
