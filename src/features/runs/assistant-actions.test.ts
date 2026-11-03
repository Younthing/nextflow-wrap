import { describe, expect, it } from "vitest";

import { cancelBlockers, cancelConfirmView, resumeBlockers, resumeConfirmView } from "./assistant-actions";

describe("cancel and resume confirmation", () => {
  it("uses a destructive confirm only while the run can be stopped", () => {
    expect(cancelBlockers({ status: "running" })).toEqual([]);
    expect(cancelConfirmView("tender_curie", []).type).toBe("delete");
    expect(cancelBlockers({ status: "running", phase: "cancelling" })).toEqual(["这次运行正在停止。"]);
    expect(cancelConfirmView("tender_curie", cancelBlockers({ status: "succeeded" })).type).toBe("info");
  });

  it("requires a finished run with a Nextflow session before resume", () => {
    expect(resumeBlockers({ status: "running", nextflowSessionId: "ses" })).toEqual(["运行还在进行，不能恢复。可以先停止，或等它结束。"]);
    expect(resumeBlockers({ status: "failed" })).toEqual(["这次运行没有 Nextflow session，不能从这里恢复。"]);
    expect(resumeConfirmView("tender_curie", []).type).toBe("default");
    expect(resumeConfirmView("tender_curie", resumeBlockers({ status: "failed" })).type).toBe("info");
  });
});

