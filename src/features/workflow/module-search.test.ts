import { describe, expect, it } from "vitest";

import { BUILTIN_MODULES } from "./builtins";
import {
  EXAMPLE_CLUSTER_ID,
  EXAMPLE_DOCK_ID,
  EXAMPLE_FASTQ_QC_ID,
  EXAMPLE_MODULES,
  EXAMPLE_REPORT_ID,
  EXAMPLE_SCANPY_QC_ID,
  EXAMPLE_TRIM_ID,
} from "./example-modules";
import { modulesForSearch, moduleSearchEmptyLabel, type PendingConnection } from "./module-search";
import type { ModuleDef, PortDef } from "./types";

const all: ModuleDef[] = [...BUILTIN_MODULES, ...EXAMPLE_MODULES];
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
  const adata = from(EXAMPLE_SCANPY_QC_ID, "adata", "source", "out");

  it("lists only modules that can take a dangling AnnData output", () => {
    const hits = modulesForSearch(all, "", adata);
    const listed = hits.map((hit) => hit.def.id);

    expect(listed).not.toContain(EXAMPLE_FASTQ_QC_ID);
    expect(listed).not.toContain(EXAMPLE_TRIM_ID);
    expect(listed).not.toContain(EXAMPLE_DOCK_ID);
    expect(listed).toContain(EXAMPLE_CLUSTER_ID);
    expect(listed).toContain(EXAMPLE_REPORT_ID);
    expect(hits.find((hit) => hit.def.id === EXAMPLE_CLUSTER_ID)?.port?.name).toBe("adata");
    expect(hits.find((hit) => hit.def.id === EXAMPLE_REPORT_ID)?.port?.name).toBe("files");
    expect(listed.indexOf(EXAMPLE_CLUSTER_ID)).toBeLessThan(listed.indexOf(EXAMPLE_REPORT_ID));
  });

  it("keeps a typed query inside the compatible set", () => {
    expect(ids("vina", adata)).toEqual([]);
    expect(ids("leiden", adata)).toEqual([EXAMPLE_CLUSTER_ID]);
  });

  it("lists read processors for a FastQ output and skips AnnData inputs", () => {
    const reads = from("builtin/samplesheet", "reads", "source", "out");
    const hits = modulesForSearch(all, "", reads);
    const listed = hits.map((hit) => hit.def.id);

    expect(listed).toContain(EXAMPLE_FASTQ_QC_ID);
    expect(listed).toContain(EXAMPLE_TRIM_ID);
    expect(listed).not.toContain(EXAMPLE_SCANPY_QC_ID);
    expect(hits.find((hit) => hit.def.id === EXAMPLE_TRIM_ID)?.port?.name).toBe("reads");
    expect(listed.indexOf(EXAMPLE_FASTQ_QC_ID)).toBeLessThan(listed.indexOf(EXAMPLE_REPORT_ID));
  });

  it("finds modules that emit a channel into a dangling input", () => {
    const clusterIn = from(EXAMPLE_CLUSTER_ID, "adata", "target", "in");
    const hits = modulesForSearch(all, "", clusterIn);

    expect(hits.map((hit) => hit.def.id)).not.toContain(EXAMPLE_FASTQ_QC_ID);
    expect(hits.find((hit) => hit.def.id === EXAMPLE_SCANPY_QC_ID)?.port?.elements.some((el) => el.format === "h5ad")).toBe(true);
  });

  it("searches the whole catalog when no link is pending", () => {
    expect(ids("")).toEqual(all.map((module) => module.id));
    expect(ids("scanpy")).toContain(EXAMPLE_SCANPY_QC_ID);
  });

  it("returns nothing when no port agrees, including after the query is cleared", () => {
    const count: PortDef = {
      name: "count",
      description: "",
      elements: [{ name: "count", type: "integer", kind: "value", description: "A count" }],
    };
    const pending: PendingConnection = { port: count, side: "source" };
    expect(modulesForSearch(all, "", pending)).toEqual([]);
    expect(modulesForSearch(all, "scanpy", pending)).toEqual([]);
    expect(moduleSearchEmptyLabel(pending, "")).toBe("没有能连接 count [integer] 的模块");
    expect(moduleSearchEmptyLabel(pending, "scanpy")).toBe("没有能连接 count [integer] 的匹配模块");
    expect(moduleSearchEmptyLabel(undefined, "scanpy")).toBe("没有匹配的模块");
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
