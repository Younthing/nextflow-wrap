import { GenerateError, generateProject, type GeneratedProject } from "@/features/project/generate";
import {
  launchCommand,
  launchProblems,
  realLaunchConfig,
  renderRunConfig,
  type LaunchConfig,
} from "@/features/project/launch";
import type { RemoteHost } from "@/features/remote/types";
import type { ModuleIndex } from "@/features/workflow/catalog";
import { launchParams } from "@/features/workflow/inputs";
import type { WorkflowDoc } from "@/features/workflow/types";
import type { HealthStatus } from "@/lib/api-types";
import type { LaunchRequest } from "./types";

/**
 * The run settings that actually apply: a cluster removed on the settings page since they
 * were saved falls back to this machine, and a real backend gets real executor settings.
 */
export function effectiveLaunchConfig(saved: LaunchConfig, remotes: readonly RemoteHost[] | undefined, real: boolean): LaunchConfig {
  const config = saved.remote && remotes && !remotes.some((host) => host.id === saved.remote)
    ? { ...saved, remote: undefined, workDir: "work" }
    : saved;
  return real ? realLaunchConfig(config) : config;
}

export type Generated = { project: GeneratedProject; error?: undefined } | { project?: undefined; error: string };

export function generateFor(doc: WorkflowDoc, index: ModuleIndex, registry: string): Generated {
  try {
    return { project: generateProject(doc, index, { registry }) };
  } catch (error) {
    if (error instanceof GenerateError) return { error: error.message };
    throw error;
  }
}

/** What stops a run that is not a problem on a canvas node: saving, generating, run settings, the runner. */
export function setupProblems({
  docId,
  saveShortcut,
  generated,
  launch,
  health,
}: {
  docId: string;
  saveShortcut: string;
  generated: Generated | null;
  launch: LaunchConfig;
  health: HealthStatus | undefined;
}): string[] {
  const real = !!health && !health.mocked;
  return [
    ...(docId ? [] : [`请先保存流程（${saveShortcut}）`]),
    ...(generated?.error ? [`无法生成项目：${generated.error}`] : []),
    ...launchProblems(launch),
    ...(real && !health.runnerReady ? [health.diagnostics ?? "Runner 未就绪"] : []),
  ];
}

export function launchRequest(doc: WorkflowDoc, project: GeneratedProject, launch: LaunchConfig, resumeFrom?: string): LaunchRequest {
  return {
    ...(resumeFrom ? { resumeFrom } : {}),
    workflow: doc,
    project: {
      name: project.meta.name,
      files: project.files.map(({ path, content }) => ({ path, content })),
    },
    params: launchParams(doc),
    launch,
    runConfig: renderRunConfig(launch),
    command: launchCommand(launch),
  };
}
