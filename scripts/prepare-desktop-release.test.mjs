import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parse, stringify } from "yaml";
import { prepareRelease } from "./prepare-desktop-release.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "desktop-release-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = join(root, "input");
  const output = join(root, "output");
  for (const [dir, manifest, asset] of [
    ["windows", "latest.yml", "app.exe"],
    ["linux", "latest-linux.yml", "app.AppImage"],
    ["mac-arm64", "latest-mac.yml", "app-arm64.zip"],
    ["mac-x64", "latest-mac.yml", "app-x64.zip"],
  ]) {
    await mkdir(join(input, dir), { recursive: true });
    const sha512 = createHash("sha512").update(asset).digest("base64");
    await writeFile(join(input, dir, asset), asset);
    await writeFile(join(input, dir, manifest), stringify({
      version: "0.2.0", files: [{ url: asset, sha512 }], path: asset, sha512,
    }));
  }
  return { input, output };
}

test("merges both macOS architectures and keeps Windows/Linux update manifests", async (t) => {
  const { input, output } = await fixture(t);
  await prepareRelease(input, output);
  const mac = parse(await readFile(join(output, "latest-mac.yml"), "utf8"));
  assert.deepEqual(mac.files.map((file) => file.url), ["app-arm64.zip", "app-x64.zip"]);
  assert.equal(await readFile(join(output, "app.exe"), "utf8"), "app.exe");
  assert.equal(parse(await readFile(join(output, "latest-linux.yml"), "utf8")).version, "0.2.0");
});

test("refuses a release missing a platform", async (t) => {
  const { input, output } = await fixture(t);
  await rm(join(input, "windows", "latest.yml"));
  await assert.rejects(prepareRelease(input, output), /Missing update metadata/);
});

test("refuses stale or corrupted installers", async (t) => {
  const { input, output } = await fixture(t);
  await writeFile(join(input, "windows", "app.exe"), "corrupted");
  await assert.rejects(prepareRelease(input, output), /Checksum mismatch/);
});

test("refuses conflicting macOS versions", async (t) => {
  const { input, output } = await fixture(t);
  const file = join(input, "mac-x64", "latest-mac.yml");
  await writeFile(file, (await readFile(file, "utf8")).replace("0.2.0", "0.3.0"));
  await assert.rejects(prepareRelease(input, output), /Version mismatch/);
});
