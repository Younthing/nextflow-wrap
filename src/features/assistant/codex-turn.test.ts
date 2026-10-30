import { describe, expect, it } from "vitest";

import type { CodexEvent, CodexHarness, CodexSession } from "@/features/codex-harness";
import { interpretCodexEvents, parseToolReply, renderCodexPrompt, runCodexAssistant } from "./codex-turn";

const tools = [{ name: "search_modules", description: "搜索模块", parameters: { type: "object" } }];

function ids() {
  let n = 0;
  return () => `id-${++n}`;
}

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const event of events) out.push(event);
  return out;
}

describe("Codex assistant turns", () => {
  it("renders the transcript and tool list without secrets", () => {
    const prompt = renderCodexPrompt("系统提示", {
      context: [{ description: "当前流程", value: "{\"nodes\":1}" }],
      tools,
      messages: [
        { role: "user", content: [{ type: "text", text: "加一个 FastQC" }] },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call_1", function: { name: "search_modules", arguments: "{\"query\":\"fastqc\"}" } }],
        },
        { role: "tool", toolCallId: "call_1", content: "{\"moduleId\":\"nf-core/fastqc\"}" },
      ],
    });
    expect(prompt).toContain("系统提示");
    expect(prompt).toContain("当前流程");
    expect(prompt).toContain("search_modules");
    expect(prompt).toContain("加一个 FastQC");
    expect(prompt).toContain("nf-core/fastqc");
    expect(prompt).not.toContain("auth.json");
    expect(prompt).not.toContain("OPENAI_API_KEY");
  });

  it("accepts only a whole-message tool reply for a known tool", () => {
    expect(parseToolReply('{"tool":"search_modules","arguments":{"query":"fastqc"}}', ["search_modules"])).toEqual({
      name: "search_modules",
      arguments: { query: "fastqc" },
    });
    expect(parseToolReply('```json\n{"tool":"search_modules","arguments":{}}\n```', ["search_modules"])?.name).toBe("search_modules");
    expect(parseToolReply("先搜索再添加", ["search_modules"])).toBeUndefined();
    expect(parseToolReply('{"tool":"rm","arguments":{}}', ["search_modules"])).toBeUndefined();
  });

  it("streams prose and turns a JSON reply into one tool call", async () => {
    const prose: CodexEvent[] = [
      { type: "text.delta", itemId: "m", delta: "你好" },
      { type: "text.delta", itemId: "m", delta: "，流程没问题。" },
      { type: "turn.end", turnId: "turn_1", status: "completed" },
    ];
    await expect(collect(interpretCodexEvents(of(prose), ["search_modules"], ids()))).resolves.toEqual([
      { type: "TEXT_MESSAGE_CHUNK", role: "assistant", messageId: "id-1", delta: "你好" },
      { type: "TEXT_MESSAGE_CHUNK", role: "assistant", messageId: "id-1", delta: "，流程没问题。" },
    ]);

    const tool: CodexEvent[] = [
      { type: "text.delta", itemId: "m", delta: '{"tool":"search_modules","arguments":{"query":"fastqc"}}' },
      { type: "turn.end", turnId: "turn_2", status: "completed" },
    ];
    await expect(collect(interpretCodexEvents(of(tool), ["search_modules"], ids()))).resolves.toEqual([
      {
        type: "TOOL_CALL_START",
        toolCallId: "id-2",
        toolCallName: "search_modules",
        parentMessageId: "id-1",
      },
      { type: "TOOL_CALL_ARGS", toolCallId: "id-2", delta: '{"query":"fastqc"}' },
      { type: "TOOL_CALL_END", toolCallId: "id-2" },
    ]);
  });

  it("reports a failed turn", async () => {
    const events: CodexEvent[] = [
      { type: "error", message: "boom", turnId: "turn_3" },
      { type: "turn.end", turnId: "turn_3", status: "failed" },
    ];
    await expect(collect(interpretCodexEvents(of(events), [], ids()))).rejects.toThrow(/boom/);
  });

  it("opens a read-only Codex thread and does not keep it after the reply", async () => {
    let opened: unknown;
    let prompt = "";
    let closed = 0;
    const session: CodexSession = {
      events: of<CodexEvent>([
        { type: "text.delta", itemId: "m", delta: "pong" },
        { type: "turn.end", turnId: "turn_4", status: "completed" },
      ]),
      ensureThread: async () => ({ threadId: "thr_1" }),
      startTurn: async (input) => {
        prompt = input;
        return { turnId: "turn_4" };
      },
      interrupt: async () => undefined,
      respondToApproval: async () => undefined,
      close: async () => {
        closed += 1;
      },
    };
    const harness: CodexHarness = {
      probe: async () => ({ installed: true, authed: true }),
      open: async (opts) => {
        opened = opts;
        return session;
      },
    };
    const events = await collect(runCodexAssistant({
      messages: [{ role: "user", content: "ping" }],
      tools,
    }, {
      harness,
      prompt: "系统提示",
      cwd: "/work",
      model: "gpt-test",
    }));
    expect(opened).toMatchObject({
      cwd: "/work",
      model: "gpt-test",
      approvalPolicy: "never",
      sandboxPolicy: "readOnly",
      autoApproval: "decline",
    });
    expect(prompt).toContain("ping");
    expect(prompt).toContain("search_modules");
    expect(events.map((event) => event.type)).toEqual(["TEXT_MESSAGE_CHUNK"]);
    expect(closed).toBe(1);
  });
});

function of<T>(items: readonly T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}
