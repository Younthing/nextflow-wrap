import { cn } from "@/lib/utils";

/** One row of the main sidebar: a page link or a control. Collapsed, the sidebar is an icon rail. */
export const sidebarItemClass = (active: boolean, collapsed = false) =>
  cn(
    "flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
    "focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none [&_svg]:size-[18px] [&_svg]:shrink-0",
    "disabled:pointer-events-none disabled:opacity-50",
    collapsed && "relative justify-center px-0",
    active && "bg-glass-strong font-medium text-primary shadow-sm hover:bg-glass-strong hover:text-primary",
  );
