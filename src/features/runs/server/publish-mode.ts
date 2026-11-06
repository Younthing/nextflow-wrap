export type PublishMode = "copy";

/** Results must remain independent of task scratch files and survive cache cleanup. */
export async function publishMode(workDir: string, outdir: string): Promise<PublishMode> {
  void workDir;
  void outdir;
  return "copy";
}
