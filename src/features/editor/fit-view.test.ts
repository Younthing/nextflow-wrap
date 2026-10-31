import { describe, expect, it } from "vitest";

import { fitViewOptions } from "./fit-view";

describe("fitViewOptions", () => {
  it("fits the selection when any node is selected, otherwise the whole graph", () => {
    expect(fitViewOptions([{ id: "a" }, { id: "b", selected: true }])).toMatchObject({
      nodes: [{ id: "b" }],
      padding: 0.2,
      maxZoom: 1,
    });
    expect(fitViewOptions([{ id: "a" }, { id: "b" }]).nodes).toBeUndefined();
  });
});
