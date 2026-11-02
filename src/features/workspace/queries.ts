"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { CreateProjectRequest, Project, ProjectList } from "./types";

export const projectKeys = { all: ["projects"] as const };

export function useProjects() {
  return useQuery({
    queryKey: projectKeys.all,
    queryFn: () => api<ProjectList>("/projects"),
    staleTime: 10_000,
  });
}

/** The open project. `undefined` while loading; `null` once the list says nothing is open. */
export function useCurrentProject(): { project: Project | null | undefined; isPending: boolean; error: Error | null } {
  const projects = useProjects();
  const project = projects.data ? projects.data.projects.find((item) => item.id === projects.data.current) ?? null : undefined;
  return { project, isPending: projects.isPending, error: projects.error };
}

function useProjectMutation<TVariables>(request: (variables: TVariables) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: projectKeys.all });
      // Notebook lists are per project.
      void qc.invalidateQueries({ queryKey: ["notebooks"] });
    },
  });
}

export const useCreateProject = () =>
  useProjectMutation((body: CreateProjectRequest) => api<Project>("/projects", { method: "POST", body: JSON.stringify(body) }));

export const useOpenProject = () =>
  useProjectMutation((path: string) => api<Project>("/projects/open", { method: "POST", body: JSON.stringify({ path }) }));

export const useReopenProject = () =>
  useProjectMutation((id: string) => api<Project>(`/projects/${encodeURIComponent(id)}/open`, { method: "POST" }));

export const useCloseProject = () =>
  useProjectMutation(() => api<ProjectList>("/projects/close", { method: "POST" }));

export const useForgetProject = () =>
  useProjectMutation((id: string) => api<void>(`/projects/${encodeURIComponent(id)}`, { method: "DELETE" }));
