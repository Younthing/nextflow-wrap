import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { crc32, zipFiles } from "./zip";

describe("zipFiles", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("writes an archive that Python's zipfile reads back", () => {
    const dir = mkdtempSync(join(tmpdir(), "zip-test-"));
    const file = join(dir, "p.zip");
    writeFileSync(file, zipFiles([
      { path: "proj/main.nf", content: "workflow {}\n" },
      { path: "proj/说明.md", content: "中文" },
    ]));
    const out = execFileSync("python3", ["-I", "-c", "import sys,zipfile,json;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(json.dumps({n:z.read(n).decode() for n in z.namelist()}, ensure_ascii=False))", file]).toString();
    expect(JSON.parse(out)).toEqual({ "proj/main.nf": "workflow {}\n", "proj/说明.md": "中文" });
    expect(readFileSync(file).subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  });
});
