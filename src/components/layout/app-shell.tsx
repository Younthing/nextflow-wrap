"use client";

import { usePathname } from "next/navigation";

import { Toaster } from "@/components/ui/toaster";
import { AssistantButton } from "@/features/assistant/assistant-button";
import { DesktopBridge } from "@/features/desktop/desktop-bridge";
import { ProjectChip } from "@/features/workspace/components/project-chip";

import { BackendStatus } from "./backend-status";
import { isBareRoute } from "./nav";
import { Sidebar } from "./sidebar";
import { ThemeToggle } from "./theme-toggle";

/**
 * The welcome page and setup draw their own layout. Every other page gets the sidebar and a top bar with the
 * open project.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (isBareRoute(pathname)) {
    return (
      <div className="h-full">
        {children}
        <Toaster />
        <DesktopBridge />
      </div>
    );
  }
  return (
    <div className="flex h-full gap-3 p-3">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <header className="flex h-10 shrink-0 items-center gap-3 px-1">
          <ProjectChip />
          <div className="ml-auto flex items-center gap-2">
            <BackendStatus />
            <AssistantButton />
            <ThemeToggle />
          </div>
        </header>
        <main className="min-h-0 flex-1">{children}</main>
      </div>
      <Toaster />
      <DesktopBridge />
    </div>
  );
}
