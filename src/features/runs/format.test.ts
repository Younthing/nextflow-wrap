import { describe, expect, it } from "vitest";

import { formatTime, localTimeZoneLabel, taskProgressLabel } from "./format";

const empty = { total: 0, pending: 0, running: 0, completed: 0, cached: 0, failed: 0, aborted: 0 };

describe("run page clock", () => {
  it("formats instants in the requested local zone", () => {
    expect(formatTime("2026-01-01T12:00:00.000Z", "Asia/Shanghai")).toBe("2026/01/01 20:00:00");
    expect(formatTime("2026-01-01T12:00:00.000Z", "UTC")).toBe("2026/01/01 12:00:00");
    expect(formatTime("2026-01-01T00:00:00.000Z", "UTC")).toBe("2026/01/01 00:00:00");
    expect(formatTime(undefined)).toBe("—");
    expect(formatTime("not-a-date", "UTC")).toBe("—");
  });

  it("labels the offset for that zone", () => {
    expect(localTimeZoneLabel("Asia/Shanghai", new Date("2026-01-01T12:00:00.000Z"))).toMatch(/GMT\+8/);
    expect(localTimeZoneLabel("UTC", new Date("2026-01-01T12:00:00.000Z"))).toMatch(/GMT/);
  });
});

describe("task progress copy", () => {
  it("says how many tasks are done", () => {
    expect(taskProgressLabel({ ...empty, total: 13, pending: 6, running: 3, completed: 4 })).toBe("任务 4/13 完成");
    expect(taskProgressLabel({ ...empty, total: 13, completed: 10, cached: 2, failed: 1 })).toBe("任务 12/13 完成");
    expect(taskProgressLabel(empty)).toBe("正在发现任务");
  });
});
