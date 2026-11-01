import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { publishMode } from "./publish-mode";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("publishMode", () => {
  it("links when work and results share a filesystem", async () => {
    const root = await mkdtemp(join(tmpdir(), "nf-publish-"));
    directories.push(root);
    expect(await publishMode(join(root, "work"), join(root, "attempts/a/results"))).toBe("link");
  });

  it("copies for cloud or relative work directories", async () => {
    expect(await publishMode("s3://bucket/work", "/tmp/results")).toBe("copy");
    expect(await publishMode("work", "/tmp/results")).toBe("copy");
  });
});
