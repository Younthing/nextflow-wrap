import { describe, expect, it } from "vitest";

import { isShellNavActive, SHELL_NAV } from "./nav";

describe("shell nav", () => {
  it("is 流程, 笔记本, and 运行", () => {
    expect(SHELL_NAV.map((item) => [item.href, item.label])).toEqual([
      ["/workflows", "流程"],
      ["/notebooks", "笔记本"],
      ["/runs", "运行"],
    ]);
  });

  it("keeps 流程 active on the library and the editor", () => {
    expect(isShellNavActive("/workflows", "/workflows")).toBe(true);
    expect(isShellNavActive("/workflows", "/workflows/wf_demo")).toBe(true);
    expect(isShellNavActive("/workflows", "/runs")).toBe(false);
    expect(isShellNavActive("/workflows", "/")).toBe(false);
    expect(isShellNavActive("/workflows", "/workflows-extra")).toBe(false);
  });

  it("keeps 笔记本 active on the list, an editor, and publish", () => {
    expect(isShellNavActive("/notebooks", "/notebooks")).toBe(true);
    expect(isShellNavActive("/notebooks", "/notebooks/qc_summary")).toBe(true);
    expect(isShellNavActive("/notebooks", "/notebooks/qc_summary/publish")).toBe(true);
    expect(isShellNavActive("/notebooks", "/workflows/modules")).toBe(false);
    expect(isShellNavActive("/workflows", "/workflows/modules")).toBe(true);
  });

  it("keeps 运行 active on the list and a run", () => {
    expect(isShellNavActive("/runs", "/runs")).toBe(true);
    expect(isShellNavActive("/runs", "/runs/run_1")).toBe(true);
    expect(isShellNavActive("/runs", "/workflows/wf_demo")).toBe(false);
  });
});
