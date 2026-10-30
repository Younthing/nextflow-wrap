import { Suspense } from "react";
import type { Metadata } from "next";
import { Loader2 } from "lucide-react";

import { RunDetailView } from "@/features/runs/components/run-detail";

export const metadata: Metadata = { title: "运行详情" };
export const instant = false;

export default function RunPage({ params }: PageProps<"/runs/[id]">) {
  return (
    <Suspense
      fallback={
        <div className="glass grid size-full place-items-center rounded-xl">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <RunDetailView params={params} />
    </Suspense>
  );
}
