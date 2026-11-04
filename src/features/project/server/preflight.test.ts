import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findTryRunNextflow } from "@/features/notebook/execute";
import { TOOLCHAIN } from "@/lib/server/toolchain";
import { NEXTFLOW_PIN_ENV, parseNextflowVersion } from "./preflight";
import { runCommand } from "./command";

const banner = (version: string) => `\n      N E X T F L O W\n      version ${version} build 5935\n      created 04-03-2025 17:55 UTC\n      cite doi:10.1038/nbt.3820\n      http://nextflow.io\n`;

describe("Nextflow version", () => {
  it("reads the release from `nextflow -version`", () => {
    expect(parseNextflowVersion(banner("24.10.5"))).toBe("24.10.5");
    expect(parseNextflowVersion(banner("26.04.0-edge"))).toBe("26.04.0-edge");
  });

  it("reports nothing rather than guessing when the output has no release", () => {
    expect(parseNextflowVersion("Error: Unable to access jarfile")).toBeUndefined();
    expect(parseNextflowVersion("")).toBeUndefined();
  });

  it("try-run launches the same pinned release as pipeline runs and the badge", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nf-pin-"));
    // A launcher that reports whatever NXF_VER asks for, else its own 24.10.5, like the real one.
    const bin = join(dir, "nextflow");
    writeFileSync(bin, `#!/bin/sh\necho "version \${NXF_VER:-24.10.5} build 1"\n`);
    chmodSync(bin, 0o755);
    const previous = process.env.NEXTFLOW_BIN;
    process.env.NEXTFLOW_BIN = bin;
    try {
      const launcher = await findTryRunNextflow().catch(() => undefined);
      if (!launcher) return; // No supported Java on this machine.
      expect(launcher.env.NXF_VER).toBe(TOOLCHAIN.nextflow.version);
      expect(NEXTFLOW_PIN_ENV.NXF_VER).toBe(TOOLCHAIN.nextflow.version);
      expect(parseNextflowVersion(await runCommand(launcher.bin, ["-version"], { env: launcher.env, quiet: true }))).toBe(TOOLCHAIN.nextflow.version);
    } finally {
      if (previous === undefined) delete process.env.NEXTFLOW_BIN;
      else process.env.NEXTFLOW_BIN = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
