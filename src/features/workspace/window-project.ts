/** sessionStorage belongs to a window, unlike the server's recent-project registry. */
const KEY = "studio.window-project.v2";
export const windowProject = (): string | undefined => typeof window === "undefined" ? undefined : window.sessionStorage.getItem(KEY) ?? undefined;
export function selectWindowProject(id?: string) {
  if (id) window.sessionStorage.setItem(KEY, id);
  else window.sessionStorage.removeItem(KEY);
  window.dispatchEvent(new Event("studio-project-change"));
}
