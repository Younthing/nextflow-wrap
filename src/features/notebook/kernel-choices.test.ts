import { describe, expect, it } from "vitest";

import { defaultKernel, kernelChoices } from "./kernel-choices";
import { languageForKernel } from "./types";

const specs = [
  { name: "python3", displayName: "Python 3 (ipykernel)", language: "python" },
  { name: "ir", displayName: "R", language: "R" },
];

describe("kernelChoices", () => {
  it("lists only installed kernels on a real server, and marks names notebooks use that are not installed", () => {
    expect(kernelChoices(specs, { demo: false, inUse: ["python3", "py311-pandas"] })).toEqual([
      { name: "python3", label: "Python 3 (ipykernel) · python3" },
      { name: "ir", label: "R · ir" },
      { name: "py311-pandas", label: "Python 3.11 · py311-pandas", missing: true },
    ]);
  });
  it("is empty without Jupyter, apart from what notebooks name", () => {
    expect(kernelChoices([], { demo: false })).toEqual([]);
    expect(kernelChoices([], { demo: false, inUse: ["python3"] })).toEqual([{ name: "python3", label: "python3", missing: true }]);
  });
  it("keeps the seed kernels in the demo", () => {
    expect(kernelChoices([], { demo: true }).map((choice) => choice.name)).toEqual(["py311-pandas", "r-deseq2", "python3.11"]);
  });
});

describe("default kernels", () => {
  it("uses the standard Jupyter names outside the demo", () => {
    expect(defaultKernel("python", false)).toBe("python3");
    expect(defaultKernel("r", false)).toBe("ir");
    expect(defaultKernel("python", true)).toBe("py311-pandas");
    expect(languageForKernel("ir")).toBe("r");
    expect(languageForKernel("python3")).toBe("python");
  });
});
