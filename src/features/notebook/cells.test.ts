import { describe, expect, it } from "vitest";

import { cellsForRun, nextCellId } from "./cells";
import { demoNotebooks } from "./seed";

const qc = () => demoNotebooks().find((doc) => doc.id === "qc_summary")!;

describe("cellsForRun", () => {
  it("runs every non-markdown cell when no cell is selected", () => {
    expect(cellsForRun(qc()).map((cell) => cell.id)).toEqual(["c1", "c2", "c3", "c4"]);
  });

  it("includes earlier cells and stops at the selected one", () => {
    expect(cellsForRun(qc(), "c2").map((cell) => cell.id)).toEqual(["c1", "c2"]);
    expect(cellsForRun(qc(), "c4").map((cell) => cell.id)).toEqual(["c1", "c2", "c3", "c4"]);
  });

  it("skips markdown and does not execute a markdown selection", () => {
    const clean = demoNotebooks().find((doc) => doc.id === "sample_clean")!;
    expect(cellsForRun(clean).map((cell) => cell.id)).toEqual(["s1"]);
    expect(cellsForRun(clean, "s2")).toEqual([]);
  });

  it("rejects an unknown cell", () => {
    expect(() => cellsForRun(qc(), "missing")).toThrow(/单元格不存在/);
  });
});

describe("nextCellId", () => {
  it("returns the following cell and stops at the end", () => {
    const cells = qc().cells;
    expect(nextCellId(cells, "c2")).toBe("c3");
    expect(nextCellId(cells, "c4")).toBeNull();
    expect(nextCellId(cells, "missing")).toBeNull();
  });
});
