import type { Metadata } from "next";
import { History } from "lucide-react";

export const metadata: Metadata = { title: "运行记录" };

export default function RunsPage() {
  return (
    <section className="glass grid size-full place-items-center rounded-xl">
      <div className="flex flex-col items-center gap-2 text-muted-foreground">
        <History className="size-8" />
        <p className="text-sm">还没有运行记录</p>
      </div>
    </section>
  );
}
