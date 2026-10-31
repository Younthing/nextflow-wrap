import { describe, expect, it } from "vitest";

import catalog from "@/data/nf-core-modules.json";
import { BUILTIN_MODULES } from "./builtins";
import { modulesForSearch, moduleSearchEmptyLabel, type PendingConnection } from "./module-search";
import type { ModuleCatalog, ModuleDef, PortDef } from "./types";

const all: ModuleDef[] = [...BUILTIN_MODULES, ...(catalog as ModuleCatalog).modules];
const def = (id: string) => all.find((module) => module.id === id)!;
const output = (id: string, name: string) => def(id).outputs.find((port) => port.name === name)!;
const input = (id: string, name: string) => def(id).inputs.find((port) => port.name === name)!;

const from = (id: string, port: string, side: PendingConnection["side"], direction: "in" | "out"): PendingConnection => ({
  port: direction === "out" ? output(id, port) : input(id, port),
  side,
});

const ids = (query: string, pending?: PendingConnection) =>
  modulesForSearch(all, query, pending).map((hit) => hit.def.id);

describe("modulesForSearch", () => {
  const bam = from("nf-core/samtools/sort", "bam", "source", "out");

  it("lists only modules that can take a dangling BAM output", () => {
    const hits = modulesForSearch(all, "", bam);
    const listed = hits.map((hit) => hit.def.id);

    expect(listed).not.toContain("nf-core/fastqc");
    expect(listed).not.toContain("nf-core/fastp");
    expect(listed).not.toContain("nf-core/trimgalore");
    expect(listed).not.toContain("nf-core/cutadapt");
    expect(listed).toContain("nf-core/samtools/flagstat");
    expect(listed).toContain("nf-core/deeptools/bamcoverage");
    expect(listed).toContain("nf-core/picard/markduplicates");
    expect(listed).toContain("nf-core/gatk4/haplotypecaller");
    expect(hits.find((hit) => hit.def.id === "nf-core/samtools/flagstat")?.port?.name).toBe("bam");
    expect(hits.find((hit) => hit.def.id === "nf-core/picard/markduplicates")?.port?.name).toBe("reads");
    expect(hits.find((hit) => hit.def.id === "nf-core/bwa/mem")?.port?.name).toBe("index");
    expect(hits.find((hit) => hit.def.id === "nf-core/salmon/quant")?.port?.name).toBe("reads");
    expect(listed.indexOf("nf-core/qualimap/rnaseq")).toBe(0);
    expect(listed.indexOf("nf-core/samtools/flagstat")).toBeLessThan(listed.indexOf("nf-core/multiqc"));
  });

  it("keeps a typed query inside the compatible set", () => {
    expect(ids("fastqc", bam)).toEqual([]);
    expect(ids("flagstat", bam)).toContain("nf-core/samtools/flagstat");
    expect(ids("multiqc", bam)).toEqual(["nf-core/multiqc"]);
  });

  it("lists read processors for a FastQ output and skips BAM-only inputs", () => {
    const reads = from("builtin/samplesheet", "reads", "source", "out");
    const hits = modulesForSearch(all, "", reads);
    const listed = hits.map((hit) => hit.def.id);

    expect(listed).toContain("nf-core/fastqc");
    expect(listed).toContain("nf-core/fastp");
    expect(listed).toContain("nf-core/star/align");
    expect(listed).not.toContain("nf-core/samtools/sort");
    expect(hits.find((hit) => hit.def.id === "nf-core/star/align")?.port?.name).toBe("reads");
    expect(listed.indexOf("nf-core/fastqc")).toBeLessThan(listed.indexOf("nf-core/gunzip"));
  });

  it("finds modules that emit a channel into a dangling input", () => {
    const sortIn = from("nf-core/samtools/sort", "bam", "target", "in");
    const hits = modulesForSearch(all, "", sortIn);

    expect(hits.map((hit) => hit.def.id)).not.toContain("nf-core/fastqc");
    expect(hits.map((hit) => hit.def.id)).toContain("nf-core/star/align");
    expect(hits.find((hit) => hit.def.id === "nf-core/star/align")?.port?.elements.some((el) => el.format === "bam")).toBe(
      true,
    );
  });

  it("searches the whole catalog when no link is pending", () => {
    expect(ids("")).toEqual(all.map((module) => module.id));
    expect(ids("fastqc")).toContain("nf-core/fastqc");
  });

  it("returns nothing when no port agrees, including after the query is cleared", () => {
    const count: PortDef = {
      name: "count",
      description: "",
      elements: [{ name: "count", type: "integer", kind: "value", description: "A count" }],
    };
    const pending: PendingConnection = { port: count, side: "source" };
    expect(modulesForSearch(all, "", pending)).toEqual([]);
    expect(modulesForSearch(all, "fastqc", pending)).toEqual([]);
    expect(moduleSearchEmptyLabel(pending, "")).toBe("没有能连接 count [integer] 的模块");
    expect(moduleSearchEmptyLabel(pending, "fastqc")).toBe("没有能连接 count [integer] 的匹配模块");
    expect(moduleSearchEmptyLabel(undefined, "fastqc")).toBe("没有匹配的模块");
  });

  it("fills a missing FastQ type from the port description", () => {
    const reads = untypedReads("List of input FastQ files of size 1 and 2.");
    const bamConsumer = typedInput("typed", "bam");
    const pendingBam: PendingConnection = { port: filePort("bam", "bam"), side: "source" };
    const pendingFastq: PendingConnection = { port: filePort("reads", "fastq"), side: "source" };

    expect(modulesForSearch([reads, bamConsumer], "", pendingBam).map((hit) => hit.def.id)).toEqual(["typed"]);
    expect(modulesForSearch([reads, bamConsumer], "", pendingFastq).map((hit) => hit.def.id)).toEqual(["reads"]);
    expect(modulesForSearch([reads], "fastq", pendingBam)).toEqual([]);
  });
});

function filePort(name: string, format: string): PortDef {
  return {
    name,
    description: "",
    elements: [
      { name: "meta", type: "map", kind: "meta", description: "" },
      { name, type: "file", kind: "file", description: "", format },
    ],
  };
}

function untypedReads(description: string): ModuleDef {
  return {
    ...module("reads", [
      {
        name: "reads",
        description,
        elements: [
          { name: "meta", type: "map", kind: "meta", description: "" },
          { name: "reads", type: "file", kind: "file", description },
        ],
      },
    ]),
    name: "fastq reads",
    keywords: ["fastq"],
  };
}

function typedInput(id: string, format: string): ModuleDef {
  return module(id, [filePort(format, format)]);
}

function module(id: string, inputs: PortDef[]): ModuleDef {
  return {
    id,
    path: id,
    name: id,
    process: id.toUpperCase(),
    category: "test",
    description: "",
    keywords: [],
    tools: [],
    inputs,
    outputs: [],
  };
}
