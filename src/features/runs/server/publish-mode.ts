import { mkdir, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";

export type PublishMode = "link" | "copy";

const remote = (path: string) => /^[a-z][a-z0-9+.-]*:\/\//i.test(path);

/**
 * Hard links cost no space and survive `nextflow clean`, but only work inside one filesystem.
 * Publish with `link` when the work and results directories share a device, otherwise `copy`.
 * A cloud work directory or one this machine cannot see always copies.
 */
export async function publishMode(workDir: string, outdir: string): Promise<PublishMode> {
  if (remote(workDir) || remote(outdir) || !isAbsolute(workDir) || !isAbsolute(outdir)) return "copy";
  try {
    await mkdir(workDir, { recursive: true });
    await mkdir(outdir, { recursive: true });
    const [work, out] = await Promise.all([stat(workDir), stat(outdir)]);
    return work.dev === out.dev ? "link" : "copy";
  } catch {
    return "copy";
  }
}
