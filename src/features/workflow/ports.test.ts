import { describe, expect, it } from "vitest";

import catalog from "@/data/nf-core-modules.json";
import { BUILTIN_MODULES, withReferenceFormat } from "./builtins";
import { checkCompatibility } from "./ports";
import type { ModuleCatalog, ModuleDef, PortDef } from "./types";

const modules = new Map(
  [...BUILTIN_MODULES, ...(catalog as ModuleCatalog).modules].map((m) => [m.id, m]),
);
const mod = (id: string) => modules.get(id)!;
const output = (def: ModuleDef, name: string) => def.outputs.find((p) => p.name === name)!;
const input = (def: ModuleDef, name: string) => def.inputs.find((p) => p.name === name)!;

describe("checkCompatibility", () => {
  it("links matching [meta, file] channels directly", () => {
    const result = checkCompatibility(
      output(mod("nf-core/fastp"), "reads"),
      input(mod("nf-core/fastqc"), "reads"),
    );
    expect(result).toEqual({ ok: true, adapter: "direct", warning: undefined });
  });

  it("pads optional trailing files", () => {
    const result = checkCompatibility(
      output(mod("builtin/samplesheet"), "reads"),
      input(mod("nf-core/fastp"), "reads"),
    );
    expect(result.ok).toBe(true);
    expect(result.adapter).toBe("pad");
  });

  it("strips meta when the input takes bare files", () => {
    const fasta = input(mod("nf-core/deeptools/bamcoverage"), "fasta");
    const ref = withReferenceFormat(mod("builtin/reference"), "fasta");
    const result = checkCompatibility(output(ref, "with_meta"), fasta);
    expect(result).toMatchObject({ ok: true, adapter: "strip-meta" });
  });

  it("rejects a bare file into a meta tuple", () => {
    const result = checkCompatibility(
      output(mod("builtin/reference"), "file"),
      input(mod("nf-core/samtools/sort"), "bam"),
    );
    expect(result.ok).toBe(false);
  });

  it("warns on a format mismatch but allows the link", () => {
    const result = checkCompatibility(
      output(mod("nf-core/fastqc"), "html"),
      input(mod("nf-core/samtools/sort"), "bam"),
    );
    expect(result.ok).toBe(true);
    expect(result.warning).toContain("html → bam");
  });

  it("never links into value widgets", () => {
    const widget: PortDef = { name: "flag", description: "", widget: "boolean", elements: [] };
    expect(checkCompatibility(output(mod("nf-core/fastp"), "reads"), widget).ok).toBe(false);
  });

  it("feeds MultiQC from any [meta, file] output", () => {
    const multiqc = input(mod("nf-core/multiqc"), "multiqc_files");
    expect(multiqc.collect).toBe(true);
    expect(checkCompatibility(output(mod("nf-core/fastqc"), "zip"), multiqc).ok).toBe(true);
  });
});
