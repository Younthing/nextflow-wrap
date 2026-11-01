import { describe, expect, it } from "vitest";

import type { ModuleDef } from "@/features/workflow/types";
import { languageForKernel, normalizeKernelName } from "./types";
import { cleanEnvField, missingEnvLabels, patchModuleEnv } from "./env";

const base = {
  id: "script/qc_summary/v1",
  path: "qc_summary_v1",
  name: "qc_summary",
  process: "QC_SUMMARY",
  category: "自定义",
  description: "",
  keywords: [],
  tools: [],
  inputs: [],
  outputs: [],
  origin: "script",
  kernel: "py311-pandas",
} satisfies ModuleDef;

describe("module env fields", () => {
  it("trims values and clears blanks", () => {
    const next = patchModuleEnv(base, {
      condaYaml: "  /envs/py311-pandas.yml  ",
      containerImage: "  ",
    });
    expect(next.condaYaml).toBe("/envs/py311-pandas.yml");
    expect(next.containerImage).toBeUndefined();
    expect(next.kernel).toBe("py311-pandas");
  });

  it("leaves a field alone when the patch omits it", () => {
    const next = patchModuleEnv({ ...base, condaYaml: "/envs/keep.yml", containerImage: "img:1" }, {
      containerImage: "ghcr.io/org/py311-pandas:1.2",
    });
    expect(next.condaYaml).toBe("/envs/keep.yml");
    expect(next.containerImage).toBe("ghcr.io/org/py311-pandas:1.2");
  });

  it("rejects newlines that would break a process directive", () => {
    expect(() => cleanEnvField("/envs/a\n.yml", "Conda yaml 路径")).toThrow(/换行/);
    expect(missingEnvLabels({ condaYaml: "/envs/a.yml" })).toEqual(["容器地址"]);
    expect(missingEnvLabels({})).toEqual(["Conda yaml", "容器地址"]);
    expect(missingEnvLabels({ condaYaml: "/envs/a.yml", containerImage: "img:1" })).toEqual([]);
  });
});

describe("kernel names", () => {
  it("keeps known kernels and treats a custom R name as R", () => {
    expect(languageForKernel("py311-pandas")).toBe("python");
    expect(languageForKernel("r-deseq2")).toBe("r");
    expect(languageForKernel("python3.11")).toBe("python");
    expect(languageForKernel("R 4.3 · custom")).toBe("r");
    expect(languageForKernel("python:3.12")).toBe("python");
    expect(normalizeKernelName("  python:3.12  ")).toBe("python:3.12");
    expect(() => normalizeKernelName(" ")).toThrow(/不能为空/);
  });
});
