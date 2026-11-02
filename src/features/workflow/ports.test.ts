import { describe, expect, it } from "vitest";

import { BUILTIN_MODULES, FILE_ID, FOLDER_ID, formatFromPath, withFileFormat } from "./builtins";
import {
  EXAMPLE_FASTQ_QC_ID,
  EXAMPLE_MODULES,
  EXAMPLE_RECEPTOR_ID,
  EXAMPLE_REPORT_ID,
  EXAMPLE_SCANPY_QC_ID,
  EXAMPLE_TRIM_ID,
} from "./example-modules";
import { checkCompatibility } from "./ports";
import type { ModuleDef, PortDef } from "./types";

const modules = new Map([...BUILTIN_MODULES, ...EXAMPLE_MODULES].map((m) => [m.id, m]));
const mod = (id: string) => modules.get(id)!;
const output = (def: ModuleDef, name: string) => def.outputs.find((p) => p.name === name)!;
const input = (def: ModuleDef, name: string) => def.inputs.find((p) => p.name === name)!;

describe("checkCompatibility", () => {
  it("links matching [meta, file] channels directly", () => {
    const result = checkCompatibility(output(mod(EXAMPLE_TRIM_ID), "reads"), input(mod(EXAMPLE_FASTQ_QC_ID), "reads"));
    expect(result).toEqual({ ok: true, adapter: "direct", warning: undefined });
  });

  it("pads optional trailing files", () => {
    const result = checkCompatibility(output(mod("builtin/samplesheet"), "reads"), input(mod(EXAMPLE_TRIM_ID), "reads"));
    expect(result).toMatchObject({ ok: true, adapter: "pad", padded: ["adapters"] });
  });

  it("strips meta when the input takes bare files", () => {
    const file = withFileFormat(mod(FILE_ID), "/data/receptor.pdb");
    const result = checkCompatibility(output(file, "file"), input(mod(EXAMPLE_RECEPTOR_ID), "receptor"));
    expect(result).toMatchObject({ ok: true, adapter: "strip-meta", warning: undefined });
  });

  it("links a chosen h5ad file straight into an AnnData input", () => {
    const file = withFileFormat(mod(FILE_ID), "/data/pbmc3k.h5ad");
    expect(checkCompatibility(output(file, "file"), input(mod(EXAMPLE_SCANPY_QC_ID), "adata"))).toEqual({
      ok: true,
      adapter: "direct",
      warning: undefined,
    });
  });

  it("warns when the chosen file has the wrong format", () => {
    const file = withFileFormat(mod(FILE_ID), "/data/ligands.sdf");
    expect(checkCompatibility(output(file, "file"), input(mod(EXAMPLE_SCANPY_QC_ID), "adata")).warning).toContain("sdf → h5ad");
  });

  it("warns when a folder goes into a file input", () => {
    expect(checkCompatibility(output(mod(FOLDER_ID), "dir"), input(mod(EXAMPLE_SCANPY_QC_ID), "adata")).warning).toContain("dir → h5ad");
  });

  it("rejects a bare file into a meta tuple", () => {
    const result = checkCompatibility(output(mod(EXAMPLE_REPORT_ID), "report"), input(mod(EXAMPLE_SCANPY_QC_ID), "adata"));
    expect(result.ok).toBe(false);
  });

  it("warns on a format mismatch but allows the link", () => {
    const result = checkCompatibility(output(mod(EXAMPLE_FASTQ_QC_ID), "html"), input(mod(EXAMPLE_SCANPY_QC_ID), "adata"));
    expect(result.ok).toBe(true);
    expect(result.warning).toContain("html → h5ad");
  });

  it("never links into value widgets", () => {
    const widget: PortDef = { name: "flag", description: "", widget: "boolean", elements: [] };
    expect(checkCompatibility(output(mod(EXAMPLE_TRIM_ID), "reads"), widget).ok).toBe(false);
  });

  it("feeds a collecting report from any [meta, file] output", () => {
    const files = input(mod(EXAMPLE_REPORT_ID), "files");
    expect(files.collect).toBe(true);
    expect(checkCompatibility(output(mod(EXAMPLE_SCANPY_QC_ID), "plots"), files)).toMatchObject({ ok: true, warning: undefined });
  });
});

describe("formatFromPath", () => {
  it("reads the extension, skipping compression", () => {
    expect(formatFromPath("/data/pbmc3k.h5ad")).toBe("h5ad");
    expect(formatFromPath("reads_1.fq.gz")).toBe("fastq");
    expect(formatFromPath("C:\\data\\genome.FA")).toBe("fasta");
    expect(formatFromPath("/data/receptor.pdbqt")).toBe("pdbqt");
  });

  it("has no format without an extension", () => {
    expect(formatFromPath("/data/matrix_dir/")).toBeUndefined();
    expect(formatFromPath("")).toBeUndefined();
  });
});
