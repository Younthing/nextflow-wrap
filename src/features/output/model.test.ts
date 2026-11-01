import { describe, expect, it } from "vitest";

import { SAMPLE_PDF } from "./samples";
import { parseDelimited, pdfDataUrl, viewFromText } from "./model";

describe("parseDelimited", () => {
  it("reads csv and tsv rows, including quoted commas", () => {
    expect(parseDelimited("sample,reads\nS1,10\n", ",")).toEqual({
      columns: ["sample", "reads"],
      rows: [["S1", "10"]],
      truncated: false,
    });
    expect(parseDelimited("name,note\n\"S1\",\"a,b\"\n", ",").rows).toEqual([["S1", "a,b"]]);
    expect(parseDelimited("name\n\"a\"\"b\"\n", ",").rows).toEqual([["a\"b"]]);
    expect(parseDelimited("sample\treads\nS1\t10\n", "\t").rows).toEqual([["S1", "10"]]);
  });

  it("returns no columns for an empty payload and caps long tables", () => {
    expect(parseDelimited("   \n", ",").columns).toEqual([]);
    const rows = Array.from({ length: 600 }, (_, index) => `S${index},1`);
    const table = parseDelimited(["sample,reads", ...rows].join("\n"), ",");
    expect(table.rows).toHaveLength(500);
    expect(table.truncated).toBe(true);
  });
});

describe("pdf and text views", () => {
  it("accepts a real PDF payload and rejects other base64", () => {
    expect(pdfDataUrl(SAMPLE_PDF)).toMatch(/^data:application\/pdf;base64,/);
    expect(pdfDataUrl("aGVsbG8=")).toBeUndefined();
  });

  it("turns markdown and csv into renderer views", () => {
    expect(viewFromText("markdown", "# 备注\n")).toMatchObject({ kind: "markdown" });
    expect(viewFromText("csv", "sample,reads\nS1,10\n")).toMatchObject({
      kind: "table",
      columns: ["sample", "reads"],
    });
    expect(viewFromText("text", "plain")).toMatchObject({ kind: "text", text: "plain" });
  });
});
