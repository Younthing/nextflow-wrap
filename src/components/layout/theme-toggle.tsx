"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";

import { applyTheme, type Theme } from "@/lib/theme";
import { sidebarItemClass } from "./sidebar-item";

/** Sidebar row that flips between light and dark. */
export function ThemeToggle({ collapsed = false }: { collapsed?: boolean }) {
  const [theme, setTheme] = React.useState<Theme | null>(null);

  React.useEffect(() => {
    // The init script already set the class; read it back once on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(
      document.documentElement.classList.contains("dark") ? "dark" : "light",
    );
  }, []);

  const next: Theme = theme === "dark" ? "light" : "dark";
  const label = next === "dark" ? "深色模式" : "浅色模式";

  return (
    <button
      type="button"
      // Open, the visible text names it; folded to an icon, the label does.
      aria-label={collapsed ? label : undefined}
      title={collapsed ? label : undefined}
      className={sidebarItemClass(false, collapsed)}
      onClick={() => {
        applyTheme(next);
        setTheme(next);
      }}
    >
      {theme === "dark" ? <Sun /> : <Moon />}
      {collapsed ? null : label}
    </button>
  );
}
