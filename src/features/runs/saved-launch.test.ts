import { describe, expect, it } from "vitest";

import { defaultLaunchConfig } from "@/features/project/launch";
import { readLaunchConfig, rememberLaunchConfig, rememberLaunchDefaults, type LaunchStorage } from "./saved-launch";

function memory(): LaunchStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe("saved launch config", () => {
  it("round-trips the settings the run dialog and the assistant share", () => {
    const storage = memory();
    const config = { ...defaultLaunchConfig(), workDir: "/tmp/work", engine: "docker" as const, runName: "secret_name" };
    rememberLaunchConfig("qc-smoke", config, storage);
    expect(readLaunchConfig("qc-smoke", storage)).toMatchObject({ workDir: "/tmp/work", engine: "docker", runName: undefined });
    expect(readLaunchConfig("other", storage)).toEqual(defaultLaunchConfig());
  });

  it("starts a new workflow from the settings page defaults", () => {
    const storage = memory();
    rememberLaunchDefaults({ engine: "conda", cpus: 6, memory: "12.GB" }, storage);
    expect(readLaunchConfig("fresh", storage)).toMatchObject({ engine: "conda", settings: { cpus: 6, memory: "12.GB" } });
    rememberLaunchConfig("fresh", { ...defaultLaunchConfig(), engine: "docker" }, storage);
    expect(readLaunchConfig("fresh", storage).engine).toBe("docker");
  });

  it("falls back when the stored value is not JSON", () => {
    const storage = memory();
    storage.setItem("nf-studio-launch:qc-smoke", "{");
    expect(readLaunchConfig("qc-smoke", storage)).toEqual(defaultLaunchConfig());
  });

  it("uses defaults when reading localStorage throws SecurityError", () => {
    const restore = blockLocalStorage();
    try {
      expect(readLaunchConfig("qc-smoke")).toEqual(defaultLaunchConfig());
      expect(() => rememberLaunchConfig("qc-smoke", defaultLaunchConfig())).not.toThrow();
    } finally {
      restore();
    }
  });
});

/** Browser policy can throw when the localStorage property itself is read. */
function blockLocalStorage() {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new DOMException("The operation is insecure.", "SecurityError");
    },
  });
  return () => {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  };
}
