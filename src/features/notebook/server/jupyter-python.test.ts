import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { findJupyterPython, jupyterPythonCandidates } from "./kernels";

describe("finding a Python with Jupyter", () => {
  let dir: string;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("looks at the active conda env, PATH, then the usual conda installs in the home folder", () => {
    const candidates = jupyterPythonCandidates({ CONDA_PREFIX: "/envs/x" }, "/home/me");
    expect(candidates.slice(0, 3)).toEqual(["/envs/x/bin/python3", "python3", "/home/me/miniconda3/bin/python3"]);
    expect(candidates).toContain("/home/me/anaconda3/bin/python3");
    expect(jupyterPythonCandidates({}, "/home/me")[0]).toBe("python3");
  });

  it("picks the first interpreter that can import jupyter_client, skipping missing ones", () => {
    dir = mkdtempSync(join(tmpdir(), "nfs-py-"));
    const fake = (name: string, ok: boolean) => {
      const path = join(dir, name);
      writeFileSync(path, `#!/bin/sh\nexit ${ok ? 0 : 1}\n`);
      chmodSync(path, 0o755);
      return path;
    };
    const without = fake("system-python", false);
    const conda = fake("conda-python", true);
    expect(findJupyterPython([join(dir, "missing"), without, conda])).toBe(conda);
    expect(findJupyterPython([without])).toBeUndefined();
  });
});
