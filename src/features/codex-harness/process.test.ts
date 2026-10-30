import { expect, it } from "vitest";

import { CodexHarnessError } from "@/features/codex-harness/errors";
import { spawnCodexChild } from "@/features/codex-harness/process";

it("reads newline-delimited stdout from a real process and stops it", async () => {
  const child = spawnCodexChild({
    binaryPath: process.execPath,
    args: ["-e", "process.stdout.write('one\\n'); process.stderr.write('warn\\n');"],
  });
  const lines: string[] = [];
  for await (const line of child.lines()) lines.push(line);
  expect(lines).toEqual(["one"]);
  expect((await child.exited).code).toBe(0);
  expect(child.stderrTail()).toContain("warn");
  await child.close();
});

it("reports a missing cwd instead of a missing binary", () => {
  expect(() => spawnCodexChild({
    binaryPath: process.execPath,
    args: ["-e", ""],
    cwd: "/tmp/codex-harness-missing-cwd",
  })).toThrow(CodexHarnessError);
  expect(() => spawnCodexChild({
    binaryPath: process.execPath,
    args: ["-e", ""],
    cwd: "/tmp/codex-harness-missing-cwd",
  })).toThrow(/cwd does not exist/);
});

it("terminates a live process group on close", async () => {
  const child = spawnCodexChild({
    binaryPath: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
  });
  await child.close();
  const exit = await child.exited;
  expect(exit.code !== null || exit.signal !== null).toBe(true);
});
