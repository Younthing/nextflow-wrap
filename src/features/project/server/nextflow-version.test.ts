import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_NEXTFLOW_VERSION } from "@/features/settings/nextflow-version";
import { managedPaths } from "@/lib/server/toolchain";
import { runCommand } from "./command";
import { nextflowSetup, resolveNextflowVersion, selectNextflowRuntime } from "./nextflow-version";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nf-version-test-"));
  vi.stubEnv("NEXTFLOW_STUDIO_DATA_DIR", dir);
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }); });

describe("Nextflow version selection", () => {
  it.skipIf(process.platform === "win32")("keeps the selected version after shell initialization", async () => {
    const result = await runCommand(process.execPath, ["-e", "console.log(process.env.NXF_VER)"], {
      setup: nextflowSetup("export NXF_VER=24.10.0", "26.10.5"), quiet: true,
    });
    expect(result.trim()).toBe("26.10.5");
  });
  it("keeps the bundled default and exact selections offline", async () => {
    const run = vi.fn<typeof runCommand>();
    expect(await resolveNextflowVersion({ NODE_ENV: "test" }, run)).toBe(DEFAULT_NEXTFLOW_VERSION);
    expect(await resolveNextflowVersion({ NODE_ENV: "test", NEXTFLOW_STUDIO_NEXTFLOW_VERSION: "26.04.1" }, run)).toBe("26.04.1");
    expect(run).not.toHaveBeenCalled();
  });

  it("queries latest every time and rejects invalid responses instead of falling back", async () => {
    const run = vi.fn<typeof runCommand>().mockResolvedValueOnce("26.10.5\n").mockResolvedValueOnce("26.10.6\n").mockResolvedValueOnce("not a version");
    const env: NodeJS.ProcessEnv = { NODE_ENV: "test", NEXTFLOW_STUDIO_NEXTFLOW_VERSION: "latest" };
    expect(await resolveNextflowVersion(env, run)).toBe("26.10.5");
    expect(await resolveNextflowVersion(env, run)).toBe("26.10.6");
    await expect(resolveNextflowVersion(env, run)).rejects.toThrow("无法解析");
    run.mockRejectedValueOnce(new Error("network unavailable"));
    await expect(resolveNextflowVersion(env, run)).rejects.toThrow("network unavailable");
  });

  it("does not treat an arbitrary NXF_VER as the application version setting", async () => {
    expect(await resolveNextflowVersion({ NODE_ENV: "test", NXF_VER: "24.10.0" })).toBe(DEFAULT_NEXTFLOW_VERSION);
    await expect(resolveNextflowVersion({ NODE_ENV: "test", NEXTFLOW_STUDIO_NEXTFLOW_VERSION: "latest;echo bad" })).rejects.toThrow("完整版本号");
  });

  it("uses a matching custom launcher and refuses one that ignores the selected version", async () => {
    const run = vi.fn<typeof runCommand>().mockResolvedValueOnce("version 26.04.1 build 1").mockResolvedValueOnce("version 24.10.0 build 1");
    const env: NodeJS.ProcessEnv = { NODE_ENV: "test", NEXTFLOW_BIN: "/custom/nextflow", NEXTFLOW_STUDIO_NEXTFLOW_VERSION: "26.04.1" };
    expect((await selectNextflowRuntime("/custom/nextflow", env, run)).env.NXF_VER).toBe("26.04.1");
    await expect(selectNextflowRuntime("/custom/nextflow", env, run)).rejects.toThrow("实际：24.10.0");
    expect(run).toHaveBeenCalledTimes(2);
  });

  function downloads(corrupt = false) {
    const body = "official nextflow launcher";
    const digest = createHash("sha256").update(body).digest("hex");
    const version = "26.10.5";
    const url = `https://github.com/nextflow-io/nextflow/releases/download/v${version}/nextflow-${version}-dist`;
    const run = vi.fn<typeof runCommand>(async (bin, args, options) => {
      if (bin === "/old/nextflow") return "version 26.10.4 build 1";
      if (bin !== "curl") return `version ${options?.env?.NXF_VER} build 1`;
      if (args.includes("-o")) { await writeFile(args[args.indexOf("-o") + 1], corrupt ? "bad download" : body); return ""; }
      return JSON.stringify({ tag_name: `v${version}`, assets: [{ name: `nextflow-${version}-dist`, digest: `sha256:${digest}`, browser_download_url: url }] });
    });
    return { run, body };
  }

  it("replaces a mismatched bundled runtime with a verified release and reuses it offline", async () => {
    const { run, body } = downloads();
    const env: NodeJS.ProcessEnv = { NODE_ENV: "test", NEXTFLOW_STUDIO_NEXTFLOW_VERSION: "26.10.5" };
    const selected = await selectNextflowRuntime("/old/nextflow", env, run);
    expect(selected.bin).toBe(join(managedPaths().root, "nextflow", "26.10.5", "nextflow"));
    expect(await readFile(selected.bin, "utf8")).toBe(body);
    run.mockClear();
    expect((await selectNextflowRuntime("/old/nextflow", env, run)).version).toBe("26.10.5");
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toBe(selected.bin);
  });

  it("rejects corrupted downloads without installing them", async () => {
    const { run } = downloads(true);
    await expect(selectNextflowRuntime("/old/nextflow", { NODE_ENV: "test", NEXTFLOW_STUDIO_NEXTFLOW_VERSION: "26.10.5" }, run)).rejects.toThrow("校验失败");
    await expect(readFile(join(managedPaths().root, "nextflow", "26.10.5", "nextflow"))).rejects.toThrow();
  });
});
