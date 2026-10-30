import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCommand } from "./command";

describe("runCommand", () => {
  it("streams full output to disk while bounding its diagnostic tail", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nf-command-"));
    try {
      const logPath = join(directory, "console.log");
      const output = await runCommand(process.execPath, ["-e", 'process.stdout.write("x".repeat(200_000))'], { quiet: true, logPath });
      expect(output).toHaveLength(128_000);
      expect(await readFile(logPath, "utf8")).toHaveLength(200_000);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reports an actual process failure with its diagnostic output", async () => {
    await expect(runCommand(process.execPath, ["-e", 'console.error("tool failed"); process.exit(7)'], { quiet: true }))
      .rejects.toThrow(/exited with 7\ntool failed/);
  });

  it("terminates a command that exceeds its deadline", async () => {
    await expect(runCommand(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { quiet: true, timeoutMs: 100 }))
      .rejects.toThrow("Command timed out");
  });
});
