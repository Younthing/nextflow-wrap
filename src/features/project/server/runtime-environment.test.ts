import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { commandWithSetup, runCommand, spawnDetached } from "./command";
import { findNextflow } from "./preflight";
import { runtimeEnvironment } from "./runtime-environment";

const directories: string[] = [];
const temporary = async () => {
  const dir = await mkdtemp(join(tmpdir(), "nf-runtime-test-"));
  directories.push(dir);
  return dir;
};
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

it("keeps unconfigured commands shell-free", () => {
  expect(commandWithSetup("nextflow", ["run", "a b"], " \n")).toEqual({ executable: "nextflow", args: ["run", "a b"] });
});

// Nextflow executes on macOS/Linux, including the WSL service used by Windows desktop.
describe.skipIf(process.platform === "win32")("Nextflow Bash initialization", () => {
  it("loads a conda-style shell function, discovers tools on its PATH and preserves multiline exports", async () => {
    const dir = await temporary();
    const bin = join(dir, "env with spaces", "bin");
    await mkdir(bin, { recursive: true });
    const nextflow = join(bin, "nextflow");
    await writeFile(nextflow, '#!/bin/sh\nprintf "%s" "$CONDA_DEFAULT_ENV"\n');
    await chmod(nextflow, 0o755);
    const init = join(dir, "conda.sh");
    await writeFile(init, 'conda() { export CONDA_DEFAULT_ENV="$2"; export PATH="$TEST_ENV_BIN:$PATH"; }\n');
    const env = { ...process.env, TEST_ENV_BIN: bin, TEST_CONDA_INIT: init, NEXTFLOW_STUDIO_NEXTFLOW_SETUP: [
      'echo "initializing { not JSON }"',
      'source "$TEST_CONDA_INIT"',
      "conda activate bia-main",
      "export MULTILINE=$'a=b\\n第二行'",
      "unset TEST_ENV_BIN",
    ].join("\n") };
    const activated = await runtimeEnvironment(env);
    expect(activated.CONDA_DEFAULT_ENV).toBe("bia-main");
    expect(activated.MULTILINE).toBe("a=b\n第二行");
    expect(activated.TEST_ENV_BIN).toBeUndefined();
    expect(env.TEST_ENV_BIN).toBe(bin);
    expect(await findNextflow({ ...activated, NEXTFLOW_BIN: undefined })).toBe(nextflow);
    expect(await runCommand(nextflow, [], { env: activated, quiet: true })).toBe("bia-main");
  });

  it("runs setup before exec, keeps argv literal and propagates the tool's exit status", async () => {
    const literal = "a b; $(touch never-create) ' \"";
    const output = await runCommand(process.execPath, ["-e", 'console.log(JSON.stringify([process.env.NF_TEST_ENV, process.argv[1]]))', literal], {
      setup: "export NF_TEST_ENV=bia-main", quiet: true,
    });
    expect(JSON.parse(output)).toEqual(["bia-main", literal]);
    await expect(runCommand(process.execPath, ["-e", "process.exit(7)"], { setup: "true", quiet: true }))
      .rejects.toMatchObject({ exitCode: 7 });
  });

  it("stops on initialization failure, retaining diagnostics without starting the tool", async () => {
    const dir = await temporary();
    const file = join(dir, "should-not-exist");
    await expect(runCommand(process.execPath, ["-e", 'require("fs").writeFileSync(process.argv[1], "started")', file], {
      setup: "echo 'activation failed' >&2\nfalse\nexport SHOULD_NOT_RUN=1", quiet: true,
    })).rejects.toThrow(/activation failed[\s\S]*Nextflow 启动前命令执行失败/);
    await expect(readFile(file)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(runtimeEnvironment({ ...process.env, NEXTFLOW_STUDIO_NEXTFLOW_SETUP: "false" })).rejects.toThrow("启动前命令执行失败");
  });

  it("keeps the detached PID and writes initialization output to the run log", async () => {
    const dir = await temporary();
    const file = join(dir, "console.log");
    const head = await spawnDetached(process.execPath, ["-e", 'console.log(process.pid, process.env.NF_TEST_ENV)'], {
      setup: "echo activating\nexport NF_TEST_ENV=bia-main", logPath: file,
    });
    expect(await head.exited).toBe(0);
    expect(await readFile(file, "utf8")).toBe(`activating\n${head.pid} bia-main\n`);
  });
});
