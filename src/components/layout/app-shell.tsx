"use client";

import { usePathname } from "next/navigation";

import { Toaster } from "@/components/ui/toaster";
import { DesktopBridge } from "@/features/desktop/desktop-bridge";
import { DesktopMenuBridge } from "@/features/desktop/desktop-menu-bridge";
import { shownWidth } from "@/lib/panel-size";

import { PANELS, useHydrateLayout, usePanel } from "./layout-store";
import { isBareRoute } from "./nav";
import { ResizeHandle } from "./resize-handle";
import { Sidebar } from "./sidebar";

/**
 * The welcome page and setup draw their own layout. Every other page gets the sidebar, which the user can drag
 * wider or narrower or fold to an icon rail, and the page next to it.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const nav = usePanel("nav");
  useHydrateLayout();
  if (isBareRoute(pathname)) {
    return (
      <div className="h-full">
        {children}
        <Toaster />
        <DesktopBridge />
        <DesktopMenuBridge />
      </div>
    );
  }
  return (
    <div className="flex h-full p-3">
      <div className="panel-animate h-full shrink-0" style={{ width: shownWidth(PANELS.nav, nav) }}>
        <Sidebar collapsed={nav.collapsed} />
      </div>
      <ResizeHandle panel="nav" />
      <main className="min-h-0 min-w-0 flex-1">{children}</main>
      <Toaster />
      <DesktopBridge />
      <DesktopMenuBridge />
    </div>
  );
}
