"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { CreateProjectRequest, Project, ProjectList } from "./types";
import { selectWindowProject, windowProject } from "./window-project";

export const projectKeys = { all: ["projects"] as const };

export const projectsQuery = {
  queryKey: projectKeys.all,
  queryFn: async () => ({ ...await api<ProjectList>("/projects"), current: windowProject() }),
  staleTime: 10_000,
};

export function useProjects() {
  return useQuery(projectsQuery);
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
    onSuccess: async (result, variables) => {
      const project = result as Partial<Project> | undefined;
      if (project?.id && project.path) selectWindowProject(project.id);
      else if (variables === undefined) selectWindowProject();
      await qc.cancelQueries();
      qc.removeQueries({ predicate: (query) => query.queryKey[0] !== "projects" });
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

export interface LegacySummary { workflows: number; modules: number }
export interface LegacyImport { workflows: number; modules: number; skipped: string[] }

/** Workflows and modules left in the database of an app version from before project folders, if any. */
export function useLegacySummary(projectId: string) {
  return useQuery({
    queryKey: [...projectKeys.all, "legacy", projectId],
    queryFn: () => api<LegacySummary | null>(`/projects/legacy?project=${encodeURIComponent(projectId)}`),
    staleTime: Infinity,
  });
}

export function useImportLegacy(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<LegacyImport>("/projects/legacy/import", { method: "POST", body: JSON.stringify({ project: projectId }) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...projectKeys.all, "legacy", projectId] });
      void qc.invalidateQueries({ queryKey: ["workflows"] });
      void qc.invalidateQueries({ queryKey: ["script-modules"] });
      void qc.invalidateQueries({ queryKey: ["fs"] });
    },
  });
}
