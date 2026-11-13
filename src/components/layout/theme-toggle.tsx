"use client";

import * as React from "react";
import { Monitor, Moon, Sun } from "lucide-react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { applyTheme, readThemePreference, THEME_STORAGE_KEY, type ThemePreference } from "@/lib/theme";
import { sidebarItemClass } from "./sidebar-item";

const OPTIONS = {
  system: { label: "跟随系统", Icon: Monitor },
  light: { label: "浅色", Icon: Sun },
  dark: { label: "深色", Icon: Moon },
};

export function ThemeToggle({ collapsed = false }: { collapsed?: boolean }) {
  const [preference, setPreference] = React.useState<ThemePreference>("system");
  React.useEffect(() => {
    const load = () => setPreference(readThemePreference());
    load();
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
      setPreference(event.newValue === "light" || event.newValue === "dark" ? event.newValue : "system");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const { label, Icon } = OPTIONS[preference];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={`外观：${label}`} title={collapsed ? `外观：${label}` : undefined} className={sidebarItemClass(false, collapsed)}>
          <Icon />
          {collapsed ? null : `外观 · ${label}`}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" aria-label="外观">
        <DropdownMenuRadioGroup value={preference} onValueChange={(value) => {
          const next = value as ThemePreference;
          setPreference(next);
          applyTheme(next);
        }}>
          {Object.entries(OPTIONS).map(([value, option]) => (
            <DropdownMenuRadioItem key={value} value={value}>{option.label}</DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
