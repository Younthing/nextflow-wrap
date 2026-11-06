/**
 * Thin fetch wrapper for the `/api` contract. In development (and until a
 * real backend exists) every call is answered by MSW in the browser.
 */
import { windowProject } from "@/features/workspace/window-project";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let project = windowProject();
  if (typeof init?.body === "string") {
    try {
      const body = JSON.parse(init.body);
      project = body.projectId ?? body.workflow?.projectId ?? project;
    } catch { /* Non-JSON bodies are handled by their endpoint. */ }
  }
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(project ? { "x-project-id": project } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body?.message ?? res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
