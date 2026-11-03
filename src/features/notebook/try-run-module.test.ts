import { describe, expect, it } from "vitest";

import { convertNotebook } from "./convert";
import { fixtureNotebooks } from "./test-fixtures";
import { draftModuleDef, draftModuleFiles, moduleRunParams, parseModuleOutputs, tryRunNextflowConfig } from "./try-run-module";
import type { MarkerInput } from "./types";

const input = (name: string, type: string, extra?: Partial<MarkerInput>): MarkerInput => ({
  name,
  type,
  required: extra?.required ?? true,
  defaultValue: extra?.defaultValue,
});

describe("try-run draft module", () => {
  it("lays the converted notebook out as modules/local/<slug> with its CLI under resources/usr/bin", () => {
    const qc = fixtureNotebooks().find((doc) => doc.id === "qc_summary")!;
    const converted = convertNotebook(qc);
    const def = draftModuleDef(qc, converted, { containerImage: "python:3.11-slim" });
    const files = draftModuleFiles(def);
    expect(files.map((file) => file.path)).toEqual([
      "modules/local/qc_summary/main.nf",
      "modules/local/qc_summary/meta.yml",
      "modules/local/qc_summary/resources/usr/bin/qc_summary.py",
    ]);
    expect(files[0].content).toContain("container 'python:3.11-slim'");
    expect(files[2].content).toBe(converted.script);
    expect(files[2].executable).toBe(true);
  });

  it("enables module binaries and the chosen engine", () => {
    expect(tryRunNextflowConfig({ via: "host" })).toBe("// Put the module's resources/usr/bin on PATH and mount it in containers\nnextflow.enable.moduleBinaries = true\n");
    expect(tryRunNextflowConfig({ via: "container", tool: { bin: "docker", kind: "docker" } })).toContain("docker.enabled = true");
    expect(tryRunNextflowConfig({ via: "container", tool: { bin: "apptainer", kind: "apptainer" } })).toContain("apptainer.autoMounts = true");
    const conda = tryRunNextflowConfig({ via: "conda", tool: { bin: "mamba", kind: "mamba" } });
    expect(conda).toContain("conda.enabled = true");
    expect(conda).toContain("conda.useMamba = true");
  });

  it("passes every port as a pipeline parameter, staged files under inputs/", () => {
    const inputs = [
      input("reads", "path[]"),
      input("sheet", "path"),
      input("ref", "dir"),
      input("min_q", "int", { required: false, defaultValue: "30" }),
      input("verbose", "bool", { required: false, defaultValue: "false" }),
      input("title", "str", { required: false }),
    ];
    expect(moduleRunParams(inputs, { reads: "a.zip,b.zip", sheet: "s.csv", ref: "/data/ref", verbose: "true" }, "inputs")).toEqual([
      "--reads", "inputs/a.zip,inputs/b.zip",
      "--sheet", "inputs/s.csv",
      "--ref", "/data/ref",
      "--min_q", "30",
      "--verbose", "true",
      "--title", "",
    ]);
    expect(() => moduleRunParams([input("sheet", "path")], {}, "inputs")).toThrow("缺少参数 sheet");
  });

  it("reads the output paths Nextflow prints as JSON", () => {
    const stdout = "Nextflow 26.10.5 is available - Please consider updating\n{\n    \"report\": \"/w/ab/report.html\",\n    \"plots\": [\"/w/ab/a.png\", \"/w/ab/b.png\"]\n}\n";
    expect(parseModuleOutputs(stdout)).toEqual({ report: ["/w/ab/report.html"], plots: ["/w/ab/a.png", "/w/ab/b.png"] });
    expect(parseModuleOutputs("not json")).toEqual({});
  });
});
