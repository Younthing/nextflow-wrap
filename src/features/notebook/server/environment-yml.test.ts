import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { readEnvironmentYml } from "./environment-yml";

describe("readEnvironmentYml", () => {
  it("copies the conda file a module names, when it is small and readable", async () => {
    const directory = mkdtempSync(join(tmpdir(), "nfs-env-"));
    try {
      const path = join(directory, "env.yml");
      writeFileSync(path, "dependencies:\n  - python=3.11\n");
      expect(await readEnvironmentYml(path)).toBe("dependencies:\n  - python=3.11");
      expect(await readEnvironmentYml(join(directory, "missing.yml"))).toBeUndefined();
      expect(await readEnvironmentYml("bioconda::samtools=1.21")).toBeUndefined();
      expect(await readEnvironmentYml(undefined)).toBeUndefined();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
