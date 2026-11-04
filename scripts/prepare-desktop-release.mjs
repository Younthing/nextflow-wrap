// Native macOS jobs each emit latest-mac.yml. Merge their file lists instead of overwriting one architecture.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";

export async function prepareRelease(input, output) {
  await mkdir(output, { recursive: true });
  const names = new Set();
  const manifests = new Map();
  for (const dir of (await readdir(input)).sort()) {
    for (const name of (await readdir(join(input, dir))).sort()) {
      const file = join(input, dir, name);
      if (/^latest.*\.yml$/.test(name)) {
        const info = parse(await readFile(file, "utf8"));
        if (!info.version || !info.files?.length) throw new Error(`Invalid update metadata: ${file}`);
        const previous = manifests.get(name);
        if (previous && previous.version !== info.version) throw new Error(`Version mismatch: ${name}`);
        manifests.set(name, previous ? { ...previous, files: [...previous.files, ...info.files] } : info);
      } else if (/\.(exe|dmg|zip|AppImage|blockmap)$/.test(name)) {
        if (names.has(name)) throw new Error(`Duplicate release asset: ${name}`);
        names.add(name);
        await copyFile(file, join(output, name));
      }
    }
  }
  for (const required of ["latest.yml", "latest-mac.yml", "latest-linux.yml"]) {
    if (!manifests.has(required)) throw new Error(`Missing update metadata: ${required}`);
  }
  for (const [name, info] of manifests) {
    const urls = new Set();
    for (const file of info.files) {
      if (basename(file.url) !== file.url || !names.has(file.url)) throw new Error(`Missing update asset: ${file.url}`);
      if (urls.has(file.url)) throw new Error(`Duplicate update asset: ${file.url}`);
      urls.add(file.url);
      const hash = createHash("sha512");
      for await (const chunk of createReadStream(join(output, file.url))) hash.update(chunk);
      if (hash.digest("base64") !== file.sha512) throw new Error(`Checksum mismatch: ${file.url}`);
    }
    await writeFile(join(output, name), stringify(info));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error("Usage: prepare-desktop-release.mjs INPUT OUTPUT");
  await prepareRelease(input, output);
}
