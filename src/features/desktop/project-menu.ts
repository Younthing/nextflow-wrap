import type { ProjectMenuState } from "../../lib/desktop";
import type { ProjectList } from "../workspace/types";

/** How many projects the File › 最近的项目 submenu lists. */
export const RECENT_LIMIT = 10;

/** The File menu's view of the project list: the open project and the most recently opened ones. */
export function projectMenuState(list: ProjectList): ProjectMenuState {
  const entry = ({ id, name, path }: { id: string; name: string; path: string }) => ({ id, name, path });
  const current = list.projects.find((project) => project.id === list.current);
  const recent = [...list.projects]
    .sort((a, b) => b.openedAt.localeCompare(a.openedAt))
    .slice(0, RECENT_LIMIT)
    .map(entry);
  return { current: current ? entry(current) : undefined, recent };
}

const isEntry = (value: unknown): value is { id: string; name: string; path: string } =>
  Boolean(value) &&
  typeof value === "object" &&
  ["id", "name", "path"].every((key) => typeof (value as Record<string, unknown>)[key] === "string");

/** The main process checks what the page sends before building a menu from it. */
export function readProjectMenuState(value: unknown): ProjectMenuState {
  if (!value || typeof value !== "object") return { recent: [] };
  const { current, recent } = value as { current?: unknown; recent?: unknown };
  return {
    current: isEntry(current) ? { id: current.id, name: current.name, path: current.path } : undefined,
    recent: Array.isArray(recent)
      ? recent.filter(isEntry).slice(0, RECENT_LIMIT).map(({ id, name, path }) => ({ id, name, path }))
      : [],
  };
}
