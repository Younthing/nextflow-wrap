import { describe, expect, it } from "vitest";

import { closeTab, MAX_TABS, openTab, pruneTabs, workbenchView } from "./tabs";

describe("workbench tabs", () => {
  it("open each notebook once, newest last", () => {
    expect(openTab(["a"], "b")).toEqual(["a", "b"]);
    expect(openTab(["a", "b"], "a")).toEqual(["a", "b"]);
  });

  it("drop the oldest past the limit", () => {
    const full = Array.from({ length: MAX_TABS }, (_, index) => `t${index}`);
    const next = openTab(full, "new");
    expect(next).toHaveLength(MAX_TABS);
    expect(next.at(-1)).toBe("new");
    expect(next[0]).toBe("t1");
  });

  it("move to the right neighbour, else the left, when closing the active tab", () => {
    expect(closeTab(["a", "b", "c"], "b", "b")).toEqual({ tabs: ["a", "c"], next: "c" });
    expect(closeTab(["a", "b", "c"], "c", "c")).toEqual({ tabs: ["a", "b"], next: "b" });
    expect(closeTab(["a"], "a", "a")).toEqual({ tabs: [], next: undefined });
    expect(closeTab(["a", "b"], "a", "b")).toEqual({ tabs: ["b"], next: "b" });
  });

  it("forget deleted notebooks", () => {
    expect(pruneTabs(["a", "gone", "b"], ["b", "a"])).toEqual(["a", "b"]);
  });

  it("read the route", () => {
    expect(workbenchView(undefined)).toEqual({ kind: "start" });
    expect(workbenchView(["nb_1"])).toEqual({ kind: "notebook", id: "nb_1" });
    expect(workbenchView(["nb_1", "publish"])).toEqual({ kind: "publish", id: "nb_1" });
    expect(workbenchView(["nb_1", "other"])).toEqual({ kind: "missing" });
    expect(workbenchView(["../x"])).toEqual({ kind: "missing" });
    expect(workbenchView(["nb_1", "publish", "x"])).toEqual({ kind: "missing" });
  });
});
