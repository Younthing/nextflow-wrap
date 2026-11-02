/**
 * Paths between this computer and the server the window talks to. A local server shares them; WSL maps Windows
 * drives to `/mnt/<x>` and the distro's own files to `\\wsl.localhost\<distro>\`; a remote server shares none.
 */
export interface PathMap {
  /** A path from a native dialog or a dropped file, as the server sees it; `undefined` when it has none. */
  toServer(local: string): string | undefined;
  /** A server path that this computer can open or show in a folder; `undefined` when it cannot. */
  toLocal(server: string): string | undefined;
}

export const sharedPaths: PathMap = { toServer: (path) => path, toLocal: (path) => path };
export const noPaths: PathMap = { toServer: () => undefined, toLocal: () => undefined };

const UNC_WSL = /^\\\\(?:wsl\.localhost|wsl\$)\\([^\\]+)(\\.*)?$/i;
const DRIVE = /^([a-z]):(?:[\\/](.*))?$/i;

/** Windows path → path inside `distro` (WSL's default `/mnt` automount root). */
export function windowsToWsl(path: string, distro: string): string | undefined {
  const unc = UNC_WSL.exec(path);
  if (unc) {
    if (unc[1]!.toLowerCase() !== distro.toLowerCase()) return undefined;
    return (unc[2] ?? "\\").replace(/\\+/g, "/").replace(/\/+$/, "") || "/";
  }
  const drive = DRIVE.exec(path);
  if (drive) {
    const rest = (drive[2] ?? "").replace(/[\\/]+/g, "/").replace(/\/+$/, "");
    return `/mnt/${drive[1]!.toLowerCase()}${rest ? `/${rest}` : ""}`;
  }
  return undefined;
}

/** Path inside `distro` → Windows path Explorer can open. */
export function wslToWindows(path: string, distro: string): string | undefined {
  if (!path.startsWith("/")) return undefined;
  const mount = /^\/mnt\/([a-z])(?:\/(.*))?$/i.exec(path);
  if (mount) return `${mount[1]!.toUpperCase()}:\\${(mount[2] ?? "").replace(/\/+/g, "\\")}`;
  return `\\\\wsl.localhost\\${distro}${path.replace(/\/+/g, "\\")}`;
}

export const wslPaths = (distro: string): PathMap => ({
  toServer: (path) => windowsToWsl(path, distro),
  toLocal: (path) => wslToWindows(path, distro),
});
