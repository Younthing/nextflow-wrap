import { describe, expect, it } from "vitest";

import { saveConfirmation } from "./save-feedback";

describe("save confirmation", () => {
  it("keeps the saved confirmation when the workflow has no errors", () => {
    expect(saveConfirmation([])).toEqual({ tone: "success", message: "已保存" });
    expect(saveConfirmation([{ level: "warning" }, { level: "warning" }])).toEqual({
      tone: "success",
      message: "已保存",
    });
  });

  it("says the workflow was saved but still has validation errors", () => {
    expect(saveConfirmation([{ level: "error" }])).toEqual({
      tone: "warning",
      message: "已保存，但仍有 1 个错误",
    });
    expect(saveConfirmation([{ level: "error" }, { level: "warning" }, { level: "error" }])).toEqual({
      tone: "warning",
      message: "已保存，但仍有 2 个错误",
    });
  });
});
