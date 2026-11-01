import { describe, expect, it } from "vitest";

import { contentTypeOf, firstPreviewable, previewKind } from "./preview";

describe("result preview kinds", () => {
  it("classifies the formats the shared renderer can open", () => {
    expect(previewKind("qc/plot.PNG")).toBe("png");
    expect(previewKind("qc/plot.svg")).toBe("svg");
    expect(previewKind("qc/report.pdf")).toBe("pdf");
    expect(previewKind("qc/reads.csv")).toBe("csv");
    expect(previewKind("qc/reads.tsv")).toBe("tsv");
    expect(previewKind("qc/notes.md")).toBe("markdown");
    expect(previewKind("qc/notes.markdown")).toBe("markdown");
    expect(previewKind("multiqc/multiqc_report.html")).toBe("html");
    expect(previewKind("qc/page.htm")).toBe("html");
    expect(previewKind("qc/photo.jpg")).toBe("jpeg");
    expect(previewKind("pipeline_info/params.json")).toBe("text");
    expect(previewKind("bam/S1.bam")).toBeNull();
    expect(previewKind("star/")).toBeNull();
  });

  it("opens the first previewable file and otherwise nothing", () => {
    const files = [
      { path: "bam/S1.bam", preview: null },
      { path: "qc/notes.md", preview: "markdown" as const },
      { path: "qc/reads.csv", preview: "csv" as const },
    ];
    expect(firstPreviewable(files)?.path).toBe("qc/notes.md");
    expect(firstPreviewable([{ path: "bam/S1.bam", preview: null }])).toBeUndefined();
    expect(firstPreviewable([])).toBeUndefined();
  });

  it("maps extensions to response types", () => {
    expect(contentTypeOf("qc/reads.csv")).toBe("text/csv");
    expect(contentTypeOf("qc/reads.tsv")).toBe("text/tab-separated-values");
    expect(contentTypeOf("qc/plot.svg")).toBe("image/svg+xml");
    expect(contentTypeOf("qc/report.pdf")).toBe("application/pdf");
    expect(contentTypeOf("pipeline_info/params.json")).toBe("application/json");
    expect(contentTypeOf("bam/S1.bam")).toBe("application/octet-stream");
  });
});
