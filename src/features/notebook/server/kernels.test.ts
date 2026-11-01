import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { NotebookDoc } from "../types";

let runNotebookCells: typeof import("../execute").runNotebookCells;
let kernels: typeof import("./kernels");

beforeAll(async () => {
  process.env.NEXTFLOW_STUDIO_DATA_DIR = mkdtempSync(join(tmpdir(), "nb-kernel-"));
  ({ runNotebookCells } = await import("../execute"));
  kernels = await import("./kernels");
});

afterAll(() => kernels.shutdownAllKernels());

const doc = (cells: NotebookDoc["cells"], id = "nb_kernel"): NotebookDoc => ({
  id,
  name: "kernel",
  description: "",
  kernel: "py311-pandas",
  language: "python",
  cells,
  rev: 1,
  createdAt: "",
  updatedAt: "",
});

const cells: NotebookDoc["cells"] = [
  { id: "a", role: "code", source: "x = 41\nprint('set')" },
  { id: "b", role: "code", source: "x += 1\nx" },
  { id: "c", role: "code", source: "open('kept.txt', 'w').write(str(x))\nraise ValueError('boom')" },
  { id: "d", role: "code", source: "print('after')" },
];

// Needs ipykernel and matplotlib for python3 (python3 -m pip install ipykernel matplotlib). Not skipped when missing.
describe("persistent Jupyter kernel", () => {
  it("lists the python3 kernelspec", async () => {
    const list = await kernels.listKernelSpecs();
    expect(list.available, list.message).toBe(true);
    expect(list.kernels.map((k) => k.name)).toContain("python3");
  }, 60_000);

  it("keeps state between single-cell runs and restarts for run-all", async () => {
    const first = await runNotebookCells(doc(cells), "a");
    expect(first.kernel).toMatchObject({ mode: "jupyter", kernel: "python3" });
    expect(first.kernel?.note).toMatch(/py311-pandas/);
    expect(first.cells[0].stdout).toBe("set\n");

    const second = await runNotebookCells(doc(cells), "b");
    expect(second.cells).toHaveLength(1);
    const result = second.cells[0].outputs?.find((o) => o.outputType === "execute_result");
    expect(result).toMatchObject({ data: { "text/plain": "42" } });
    expect(second.cells[0].executionCount).toBe(2);

    const again = await runNotebookCells(doc(cells), "b");
    expect(again.cells[0].outputs?.find((o) => o.outputType === "execute_result")).toMatchObject({ data: { "text/plain": "43" } });

    const all = await runNotebookCells(doc(cells));
    expect(all.cells.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(all.cells[1].executionCount).toBe(2);
    expect(all.cells[2].error).toMatch(/ValueError: boom/);
    expect(all.cells[2].error).not.toMatch(/\x1b\[/);
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(join(kernels.notebookWorkDir("nb_kernel"), "kept.txt"), "utf8")).toBe("42");
  }, 180_000);

  it("interrupts a running cell and keeps the kernel", async () => {
    const id = "nb_interrupt";
    const cellsLong: NotebookDoc["cells"] = [
      { id: "s", role: "code", source: "y = 7" },
      { id: "l", role: "code", source: "import time\nwhile True: time.sleep(0.1)" },
      { id: "u", role: "code", source: "y" },
    ];
    await runNotebookCells(doc(cellsLong, id), "s");
    const running = runNotebookCells(doc(cellsLong, id), "l");
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(kernels.kernelInfo(id).state).toBe("busy");
    kernels.existingKernel(id)?.interrupt();
    const stopped = await running;
    expect(stopped.cells[0].error).toMatch(/KeyboardInterrupt/);
    const after = await runNotebookCells(doc(cellsLong, id), "u");
    expect(after.cells[0].outputs?.find((o) => o.outputType === "execute_result")).toMatchObject({ data: { "text/plain": "7" } });
    expect(kernels.kernelInfo(id).state).toBe("idle");
  }, 180_000);

  it("renders matplotlib figures inline", async () => {
    const plot = await runNotebookCells(doc([
      { id: "p", role: "code", source: "import matplotlib.pyplot as plt\nplt.plot([1, 2, 3])\nplt.show()" },
    ], "nb_plot"), "p");
    const cell = plot.cells[0];
    expect(cell.outputs?.some((o) => o.outputType === "display_data" && !!o.data["image/png"])).toBe(true);
  }, 180_000);

  it("falls back to a fresh process when jupyter_client is missing", async () => {
    const root = mkdtempSync(join(tmpdir(), "nb-nojupyter-"));
    mkdirSync(join(root, "jupyter_client"));
    writeFileSync(join(root, "jupyter_client", "__init__.py"), "raise ImportError('blocked for the test')\n");
    const wrapper = join(root, "python");
    writeFileSync(wrapper, `#!/bin/sh\nPYTHONPATH="${root}" exec python3 "$@"\n`);
    chmodSync(wrapper, 0o755);
    process.env.NEXTFLOW_STUDIO_JUPYTER_PYTHON = wrapper;
    try {
      const run = await runNotebookCells(doc(cells, "nb_fallback"), "b");
      expect(run.kernel).toMatchObject({ mode: "oneshot" });
      expect(run.kernel?.note).toMatch(/blocked for the test[\s\S]*pip install ipykernel/);
      // One-shot runs from the top, so cell b sees x from cell a.
      expect(run.cells.map((c) => c.id)).toEqual(["a", "b"]);
      expect(run.cells[1].outputs?.some((o) => o.outputType === "execute_result" || o.outputType === "stream")).toBe(true);
      expect((await kernels.listKernelSpecs()).available).toBe(false);
    } finally {
      delete process.env.NEXTFLOW_STUDIO_JUPYTER_PYTHON;
    }
  }, 60_000);
});
