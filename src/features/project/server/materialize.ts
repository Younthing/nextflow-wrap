import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { GeneratedProject, RemoteComponent } from "../generate";
import { runCommand } from "./command";
import type { RuntimeTools } from "./preflight";

export function projectPath(root: string, path: string): string {
  const resolved = resolve(root, path);
  const rel = relative(resolve(root), resolved);
  if (!rel || isAbsolute(path) || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`Invalid project path: ${path}`);
  return resolved;
}

/** Caller supplies a new directory; never overwrite an existing execution. */
export async function materializeProject(project: GeneratedProject, directory: string): Promise<void> {
  await mkdir(dirname(directory), { recursive: true });
  await mkdir(directory);
  for (const file of project.files) {
    // Expected components are a lock, not evidence that nf-core has installed them.
    const path = projectPath(directory, file.path === "modules.json" ? "components.lock.json" : file.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.content, { flag: "wx" });
  }
}

interface InstalledEntry { git_sha: string }
interface InstalledManifest {
  repos: Record<string, { modules?: Record<string, Record<string, InstalledEntry>>; subworkflows?: Record<string, Record<string, InstalledEntry>> }>;
}

export async function installComponents(project: GeneratedProject, directory: string, tools: RuntimeTools, signal?: AbortSignal) {
  await mkdir(join(directory, "modules"), { recursive: true });
  await mkdir(join(directory, "subworkflows"), { recursive: true });
  for (const component of project.components) {
    signal?.throwIfAborted();
    if (!/^[a-f0-9]{40}$/.test(component.gitSha) || !/^[a-z0-9_]+(?:\/[a-z0-9_]+)*$/.test(component.path)) {
      throw new Error(`Invalid component lock: ${component.path}@${component.gitSha}`);
    }
    const group = component.kind === "module" ? "modules" : "subworkflows";
    process.stdout.write(`Installing ${group}/${component.path}@${component.gitSha}\n`);
    await runCommand(tools.nfCore, [group, "install", component.path, "--dir", directory, "--sha", component.gitSha], {
      cwd: directory, env: tools.env, logPath: join(directory, "install.log"), timeoutMs: 10 * 60_000, signal,
    });
  }
  const manifest = JSON.parse(await readFile(join(directory, "modules.json"), "utf8")) as InstalledManifest;
  const expected = new Map(project.components.map((c) => [`${c.kind}:${c.path}`, c.gitSha]));
  const installed: (RemoteComponent & { files: Record<string, string> })[] = [];
  for (const [repo, groups] of Object.entries(manifest.repos)) {
    if (repo !== "https://github.com/nf-core/modules.git") throw new Error(`Unexpected component repository: ${repo}`);
    for (const kind of ["module", "subworkflow"] as const) {
      const group = kind === "module" ? "modules" : "subworkflows";
      for (const [org, components] of Object.entries(groups[group] ?? {})) {
        if (org !== "nf-core") throw new Error(`Unexpected component organisation: ${org}`);
        for (const [path, entry] of Object.entries(components)) {
          const sha = expected.get(`${kind}:${path}`);
          if (sha && sha !== entry.git_sha) throw new Error(`Component version drift: ${path}, expected ${sha}, installed ${entry.git_sha}`);
          const root = projectPath(directory, `${group}/${org}/${path}`);
          await readFile(join(root, "main.nf"));
          const files: Record<string, string> = {};
          for (const name of (await readdir(root, { recursive: true })).sort()) {
            const content = await readFile(join(root, name)).catch((error: NodeJS.ErrnoException) => {
              if (error.code === "EISDIR") return null;
              throw error;
            });
            if (content) files[name] = createHash("sha256").update(content).digest("hex");
          }
          installed.push({ kind, path, gitSha: entry.git_sha, files });
          expected.delete(`${kind}:${path}`);
        }
      }
    }
  }
  if (expected.size) throw new Error(`Components missing after installation: ${[...expected.keys()].join(", ")}`);
  await writeFile(join(directory, "installed-components.json"), `${JSON.stringify(installed, null, 2)}\n`);
  return installed;
}
