/**
 * How workflows and notebooks name files, as ComfyUI names files in its `input/` folder: by a path relative to the
 * workspace (the project folder), such as `data/reads.fq`. The server resolves it when it runs something, so a
 * project can move or be served from another machine. URIs (`s3://…`) pass through for cloud storage; an absolute
 * path only makes sense for a cluster run, whose data lives on the cluster.
 *
 * No `node:path` here: the browser uses this too.
 */
export type DataPathKind = "workspace" | "uri" | "absolute" | "invalid";

export const isUri = (value: string) => /^[a-z][a-z0-9+.-]*:\/\//i.test(value);

/** Path segments of a relative path; `undefined` when it climbs out with `..` or is empty. */
function segments(relative: string): string[] | undefined {
  const out: string[] = [];
  for (const part of relative.split(/[\\/]+/)) {
    if (!part || part === ".") continue;
    if (part === "..") { if (out.length && out.at(-1) !== "..") out.pop(); else out.push(part); continue; }
    out.push(part);
  }
  return out.length ? out : ["."];
}

export function dataPathKind(value: string): DataPathKind {
  const text = value.trim();
  if (!text) return "invalid";
  if (isUri(text)) return "uri";
  if (text.startsWith("/") || /^[a-z]:[\\/]/i.test(text)) return "absolute";
  return segments(text) ? "workspace" : "invalid";
}

/** A workspace path in its stored form: forward slashes, no `.` parts. */
export function normalizeWorkspacePath(value: string): string | undefined {
  return dataPathKind(value) === "workspace" ? segments(value.trim())!.join("/") : undefined;
}

/** A path picked or uploaded on the server, as it is stored: relative when it is inside the workspace. */
export function toWorkspacePath(path: string, root: string | undefined): string {
  if (!root) return path;
  const base = root.replace(/\/+$/, "");
  if (path === base) return ".";
  return path.startsWith(`${base}/`) ? path.slice(base.length + 1) : path;
}

/** The absolute path of a workspace path; `undefined` when it is not one (or climbs out of the workspace). */
export function resolveWorkspacePath(value: string, root: string): string | undefined {
  const relative = normalizeWorkspacePath(value);
  return relative ? `${root.replace(/\/+$/, "")}/${relative}` : undefined;
}
