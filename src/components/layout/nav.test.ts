import { describe, expect, it } from "vitest";

import { FLOW_NAV, flowGroupOpen, isBareRoute, isFlowRoute, isNavActive, SETTINGS_NAV, WORKBENCH_NAV } from "./nav";

describe("sidebar nav", () => {
  it("is 工作台, then 流程编排, 运行记录, 产物 and 模块库 in the 流程 group", () => {
    expect(WORKBENCH_NAV).toEqual({ href: "/workbench", label: "工作台" });
    expect(FLOW_NAV.map((item) => [item.href, item.label])).toEqual([
      ["/workflows", "流程编排"],
      ["/runs", "运行记录"],
      ["/outputs", "产物"],
      ["/modules", "模块库"],
    ]);
  });

  it("keeps 工作台 active on a notebook and its publish page", () => {
    expect(isNavActive("/workbench", "/workbench")).toBe(true);
    expect(isNavActive("/workbench", "/workbench/nb_1")).toBe(true);
    expect(isNavActive("/workbench", "/workbench/nb_1/publish")).toBe(true);
    expect(isNavActive("/workbench", "/workflows")).toBe(false);
  });

  it("keeps each 流程 item active on its own pages only", () => {
    expect(isNavActive("/workflows", "/workflows/wf_demo")).toBe(true);
    expect(isNavActive("/workflows", "/workflows-extra")).toBe(false);
    expect(isNavActive("/workflows", "/modules")).toBe(false);
    expect(isNavActive("/runs", "/runs/run_1")).toBe(true);
    expect(isNavActive("/modules", "/modules")).toBe(true);
    expect(isNavActive("/outputs", "/outputs")).toBe(true);
  });

  it("treats setup as part of 设置", () => {
    expect(isNavActive(SETTINGS_NAV.href, "/settings")).toBe(true);
    expect(isNavActive(SETTINGS_NAV.href, "/setup")).toBe(true);
    expect(isNavActive(SETTINGS_NAV.href, "/workbench")).toBe(false);
  });

  it("knows the pipeline pages and the pages without a sidebar", () => {
    expect(isFlowRoute("/runs/run_1")).toBe(true);
    expect(isFlowRoute("/workbench")).toBe(false);
    expect(isBareRoute("/")).toBe(true);
    expect(isBareRoute("/setup")).toBe(true);
    expect(isBareRoute("/settings")).toBe(false);
  });

  it("defaults to open on pipeline pages and respects the user's choice", () => {
    expect(flowGroupOpen("/workbench", null)).toBe(false);
    expect(flowGroupOpen("/workbench", true)).toBe(true);
    expect(flowGroupOpen("/runs", null)).toBe(true);
    expect(flowGroupOpen("/runs", false)).toBe(false);
  });
});
