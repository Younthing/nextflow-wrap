import { describe, expect, it } from "vitest";
import { restorableMessages, type AssistantMessage } from "./history";

describe("assistant conversation replay", () => {
  it("restores completed results while removing unanswered tool calls", () => {
    const messages: AssistantMessage[] = [
      { id: "user", role: "user", content: "修改代码" },
      { id: "assistant", role: "assistant", toolCalls: [
        { id: "finished", type: "function", function: { name: "read_cell_output", arguments: "{}" } },
        { id: "pending", type: "function", function: { name: "edit_notebook_cell", arguments: "{}" } },
      ] },
      { id: "result", role: "tool", toolCallId: "finished", content: "ok" },
    ];
    expect(restorableMessages(messages)).toEqual([
      messages[0],
      expect.objectContaining({ toolCalls: [expect.objectContaining({ id: "finished" })] }),
      messages[2],
    ]);
  });
});
