import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "./command";

/**
 * Discover tools after activation, without changing the server's own environment. A private file keeps
 * setup chatter separate from exported variables and avoids truncating large environments in log tails.
 * The actual Nextflow launch also runs the setup in its own Bash before exec.
 */
export async function runtimeEnvironment(env: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
  const setup = env.NEXTFLOW_STUDIO_NEXTFLOW_SETUP;
  if (!setup?.trim()) return env;
  const dir = await mkdtemp(join(tmpdir(), "nf-environment-"));
  try {
    const file = join(dir, "environment");
    await runCommand("/bin/bash", ["--noprofile", "--norc", "-c", '/usr/bin/env -0 > "$1"', "nextflow-environment", file], {
      env, setup, quiet: true, timeoutMs: 30_000,
    });
    const entries = (await readFile(file, "utf8")).split("\0").filter(Boolean).map((entry) => {
      const at = entry.indexOf("=");
      return [entry.slice(0, at), entry.slice(at + 1)];
    });
    return Object.fromEntries(entries);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
