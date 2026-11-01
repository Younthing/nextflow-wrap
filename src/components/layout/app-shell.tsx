import { AssistantButton } from "@/features/assistant/assistant-button";

import { BackendStatus } from "./backend-status";
import { NavRail } from "./nav-rail";
import { ThemeToggle } from "./theme-toggle";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full gap-3 p-3">
      <NavRail />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <header className="glass flex h-12 shrink-0 items-center gap-3 rounded-xl px-4">
          <span className="font-serif text-base font-semibold tracking-wide">
            Nextflow Studio
          </span>
          <span className="text-xs text-muted-foreground">
            用笔记本和内置节点搭建流程
          </span>
          <div className="ml-auto flex items-center gap-2">
            <BackendStatus />
            <AssistantButton />
            <ThemeToggle />
          </div>
        </header>
        <main className="min-h-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
