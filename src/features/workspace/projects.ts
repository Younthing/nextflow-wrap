import type { Project } from "./types";

/** Id of the example project. Notebooks without a project belong to it. */
export const EXAMPLE_PROJECT_ID = "example";

/** Id of the immunofluorescence example project. */
export const IF_EXAMPLE_PROJECT_ID = "example-if";

/** Preset example projects, badged 示例 on the welcome page. */
export const isExampleProject = (id: string) => id === EXAMPLE_PROJECT_ID || id === IF_EXAMPLE_PROJECT_ID;

/** Folders created inside a new project. Notebooks stay in the app database, data and results on disk. */
export const PROJECT_SCAFFOLD = ["data", "results"] as const;

/** 32-bit FNV-1a, twice with different seeds: deterministic, dependency-free, the same in the browser and on the server. */
function fnv(text: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Strip trailing slashes so `/a/b/` and `/a/b` are one project. */
export function normalizeProjectPath(path: string): string {
  const trimmed = path.trim().replace(/\\/g, "/");
  return trimmed.length > 1 ? trimmed.replace(/\/+$/, "") || "/" : trimmed;
}

export function projectIdForPath(path: string): string {
  const normalized = normalizeProjectPath(path);
  return `p_${fnv(normalized, 0x811c9dc5)}${fnv(normalized, 0x01000193).slice(0, 4)}`;
}

/** Last path segment, used as the project name when a folder is opened. */
export function folderName(path: string): string {
  const normalized = normalizeProjectPath(path);
  return normalized.split("/").filter(Boolean).at(-1) ?? normalized;
}

const INVALID_NAME = /[/\\:*?"<>|\u0000-\u001f]/;

/** The folder name a new project gets. Returns an error message, or nothing when the name is fine. */
export function projectNameError(name: string): string | undefined {
  const trimmed = name.trim();
  if (!trimmed) return "请填写项目名称";
  if (trimmed.length > 80) return "项目名称不能超过 80 个字符";
  if (trimmed === "." || trimmed === "..") return "项目名称不能是 . 或 ..";
  if (trimmed.startsWith(".")) return "项目名称不能以 . 开头";
  if (INVALID_NAME.test(trimmed)) return "项目名称不能包含 / \\ : * ? \" < > | 或换行";
  return undefined;
}

export function joinProjectPath(parent: string, name: string): string {
  const base = normalizeProjectPath(parent);
  return `${base === "/" ? "" : base}/${name.trim()}`;
}

/** Most recently opened first. */
export function sortRecent(projects: readonly Project[]): Project[] {
  return [...projects].sort((a, b) => b.openedAt.localeCompare(a.openedAt) || a.name.localeCompare(b.name));
}

export function filterProjects(projects: readonly Project[], query: string): Project[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...projects];
  return projects.filter((project) => project.name.toLowerCase().includes(needle) || project.path.toLowerCase().includes(needle));
}

/** Upsert by id and mark it opened now. */
export function touchProject(projects: readonly Project[], project: Project, now: string): Project[] {
  const rest = projects.filter((item) => item.id !== project.id);
  const existing = projects.find((item) => item.id === project.id);
  return sortRecent([...rest, { ...(existing ?? project), name: existing?.name ?? project.name, openedAt: now }]);
}


/** Show `~` for the home folder, as file managers do. */
export function displayPath(path: string, home?: string): string {
  if (!home) return path;
  const base = normalizeProjectPath(home);
  if (path === base) return "~";
  return path.startsWith(`${base}/`) ? `~${path.slice(base.length)}` : path;
}

/** Theme tones a project badge can take; `projectBadge` picks one per name. */
export const BADGE_TONES = ["primary", "path", "file", "meta", "value", "destructive"] as const;
export type BadgeTone = (typeof BADGE_TONES)[number];

/** One character and a tone for the project's avatar, stable for a given name. */
export function projectBadge(name: string): { initial: string; tone: BadgeTone } {
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? "?";
  return { initial, tone: BADGE_TONES[parseInt(fnv(name, 0x811c9dc5).slice(0, 4), 16) % BADGE_TONES.length] };
}

/** "10 分钟前", "昨天", "10 月 21 日". */
export function openedLabel(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (then.getTime() >= startOfToday) return `${Math.floor(minutes / 60)} 小时前`;
  if (then.getTime() >= startOfToday - 86_400_000) return "昨天";
  if (then.getFullYear() === now.getFullYear()) return `${then.getMonth() + 1} 月 ${then.getDate()} 日`;
  return `${then.getFullYear()} 年 ${then.getMonth() + 1} 月 ${then.getDate()} 日`;
}
