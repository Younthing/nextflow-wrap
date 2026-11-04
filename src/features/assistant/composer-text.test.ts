import { describe, expect, it } from "vitest";

import { codeReference, insertToken } from "./composer-text";

describe("composer references", () => {
  it("inserts a backticked name with one space around it", () => {
    expect(codeReference("df")).toBe("`df`");
    expect(insertToken("", "`df`")).toBe("`df` ");
    expect(insertToken("画出", "`df`")).toBe("画出 `df` ");
    expect(insertToken("对比 `a` ", "`b`")).toBe("对比 `a` `b` ");
  });
});
