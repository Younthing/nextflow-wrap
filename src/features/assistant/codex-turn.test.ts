import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { CodexEvent, CodexHarness, CodexSession } from "@/features/codex-harness";
import {
  ASSISTANT_MAX_STEPS,
  assistantStepsUsed,
  interpretCodexEvents,
  parseToolReply,
  type PromptMessage,
  renderCodexPrompt,
  runCodexAssistant,
} from "./codex-turn";
import { createSessionPermit } from "./session-limit";

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
    expect(prompt).toContain("这次调用会被拒绝，不会执行");
    expect(prompt).toContain("这一轮最多调用 12 次工具");
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
    expect(parseToolReply('结果是 {"ok":true}', ["search_modules"])).toBeUndefined();
    expect(parseToolReply('{"tool":"search_modules","arguments":{"query":"a { b } c","nested":{"a":1}}}', ["search_modules"])).toEqual({
      name: "search_modules",
      arguments: { query: "a { b } c", nested: { a: 1 } },
    });
    expect(() => parseToolReply('{"tool":"rm","arguments":{}}', ["search_modules", "add_module"])).toThrow(
      "未知工具「rm」。只能使用：search_modules、add_module",
    );
    expect(() => parseToolReply('{"tool":"rm","arguments":{}}', [])).toThrow(/没有已注册的工具/);
    expect(() => parseToolReply('{"tool":"search_modules","arguments":[]}', ["search_modules"])).toThrow(/arguments/);
    expect(() => parseToolReply('先搜索。\n{"tool":"search_modules","arguments":{"query":"fastqc"}}', ["search_modules"])).toThrow(
      /没有执行工具/,
    );
    expect(() => parseToolReply('{"tool":"search_modules","arguments":{}}\n完成了', ["search_modules"])).toThrow(/没有执行工具/);
    expect(() => parseToolReply('先看\n```json\n{"tool":"search_modules","arguments":{}}\n```', ["search_modules"])).toThrow(
      /没有执行工具/,
    );
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

  it("treats a fence that arrives one backtick at a time as a tool call", async () => {
    const fenced = "```json\n{\"tool\":\"search_modules\",\"arguments\":{\"query\":\"fastqc\"}}\n```";
    const pieces = [fenced.slice(0, 1), fenced.slice(1, 2), fenced.slice(2)];
    const events: CodexEvent[] = [
      ...pieces.map((delta) => ({ type: "text.delta" as const, itemId: "m", delta })),
      { type: "turn.end", turnId: "turn_fence", status: "completed" },
    ];
    const out = await collect(interpretCodexEvents(of(events), ["search_modules"], ids()));
    expect(out.map((event) => event.type)).toEqual(["TOOL_CALL_START", "TOOL_CALL_ARGS", "TOOL_CALL_END"]);
    expect(out[0]).toMatchObject({ toolCallName: "search_modules" });

    const prose: CodexEvent[] = [
      { type: "text.delta", itemId: "m", delta: "`" },
      { type: "text.delta", itemId: "m", delta: "fastqc`" },
      { type: "turn.end", turnId: "turn_tick", status: "completed" },
    ];
    await expect(collect(interpretCodexEvents(of(prose), ["search_modules"], ids()))).resolves.toEqual([
      { type: "TEXT_MESSAGE_CHUNK", role: "assistant", messageId: "id-1", delta: "`fastqc`" },
    ]);
  });

  it("closes the session when cancelled before a turn id exists", async () => {
    const controller = new AbortController();
    let started = false;
    let closed = 0;
    let interrupts = 0;
    let rejectStart: (error: Error) => void = () => undefined;
    let releaseEvents: () => void = () => undefined;
    const session: CodexSession = {
      events: {
        async *[Symbol.asyncIterator]() {
          await new Promise<void>((resolve) => {
            releaseEvents = resolve;
          });
        },
      },
      ensureThread: async () => ({ threadId: "thr_cancel" }),
      startTurn: () => {
        started = true;
        return new Promise((_, reject) => {
          rejectStart = reject;
        });
      },
      interrupt: async () => {
        interrupts += 1;
        throw new Error("no active turn to interrupt");
      },
      respondToApproval: async () => undefined,
      close: async () => {
        closed += 1;
        releaseEvents();
        rejectStart(new Error("codex session closed"));
      },
    };
    const harness: CodexHarness = {
      probe: async () => ({ installed: true, authed: true }),
      open: async () => session,
    };
    const task = collect(runCodexAssistant({
      messages: [{ role: "user", content: "ping" }],
    }, {
      harness,
      prompt: "系统提示",
      cwd: "/work",
      signal: controller.signal,
    }));
    for (let attempt = 0; attempt < 50 && !started; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(started).toBe(true);
    controller.abort();
    const settled = await Promise.race([
      task.then(() => "resolved" as const, (error: unknown) => error),
      new Promise<Error>((resolve) => setTimeout(() => resolve(new Error("cancelled run did not stop")), 1_000)),
    ]);
    expect(settled).toBeInstanceOf(Error);
    expect((settled as Error).message).not.toMatch(/did not stop/);
    expect(interrupts).toBe(0);
    expect(closed).toBeGreaterThan(0);
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

  it("rejects an unknown tool and prose followed by tool JSON", async () => {
    const unknown: CodexEvent[] = [
      { type: "text.delta", itemId: "m", delta: '{"tool":"rm","arguments":{}}' },
      { type: "turn.end", turnId: "turn_unknown", status: "completed" },
    ];
    await expect(collect(interpretCodexEvents(of(unknown), ["search_modules"], ids()))).rejects.toThrow(/未知工具「rm」/);

    const mixed = '先搜索一下。\n{"tool":"search_modules","arguments":{"query":"fastqc"}}';
    const seen: { type: string }[] = [];
    await expect((async () => {
      for await (const event of interpretCodexEvents(of<CodexEvent>([
        { type: "text.delta", itemId: "m", delta: mixed },
        { type: "turn.end", turnId: "turn_mixed", status: "completed" },
      ]), ["search_modules"], ids())) seen.push(event);
    })()).rejects.toThrow(/没有执行工具/);
    expect(seen.some((event) => event.type === "TOOL_CALL_START")).toBe(false);
  });

  it("counts tool steps only after the latest user message", () => {
    expect(ASSISTANT_MAX_STEPS).toBe(12);
    const call = (id: string): PromptMessage => ({
      role: "assistant",
      content: "",
      toolCalls: [{ id, function: { name: "search_modules", arguments: "{}" } }],
    });
    expect(assistantStepsUsed([
      { role: "user", content: "旧的" },
      call("old"),
      { role: "tool", toolCallId: "old", content: "{}" },
      { role: "user", content: "新的" },
      call("c1"),
      { role: "tool", toolCallId: "c1", content: "{}" },
    ])).toBe(1);
    expect(assistantStepsUsed([
      { role: "user", content: "继续" },
      { role: "tool", toolCallId: "c1", content: "{}" },
      { role: "tool", toolCallId: "c2", content: "{}" },
    ])).toBe(2);
    expect(assistantStepsUsed([
      { role: "user", content: "新的" },
      { role: "activity", content: "thinking" },
    ])).toBe(0);
  });

  it("stops before opening Codex once the step cap is reached", async () => {
    let opened = 0;
    const capped: CodexHarness = {
      probe: async () => ({ installed: true, authed: true }),
      open: async () => {
        opened += 1;
        throw new Error("should not open");
      },
    };
    const messages: PromptMessage[] = [{ role: "user", content: "继续" }];
    for (let index = 0; index < 2; index += 1) {
      messages.push({
        role: "assistant",
        content: "",
        toolCalls: [{ id: `c${index}`, function: { name: "search_modules", arguments: "{}" } }],
      });
      messages.push({ role: "tool", toolCallId: `c${index}`, content: "{}" });
    }
    await expect(collect(runCodexAssistant({ messages }, {
      harness: capped,
      prompt: "系统提示",
      maxSteps: 2,
    }))).rejects.toThrow(/步数上限（2）/);
    expect(opened).toBe(0);

    const allowed: CodexHarness = {
      probe: async () => ({ installed: true, authed: true }),
      open: async () => scriptedSession("pong"),
    };
    await expect(collect(runCodexAssistant({
      messages: messages.slice(0, 3),
    }, {
      harness: allowed,
      prompt: "系统提示",
      cwd: "/work",
      maxSteps: 2,
    }))).resolves.toEqual([
      { type: "TEXT_MESSAGE_CHUNK", role: "assistant", messageId: expect.any(String), delta: "pong" },
    ]);
  });

  it("does not start a turn when the request is aborted while Codex is opening", async () => {
    let started = 0;
    let closed = 0;
    let releaseOpen: (session: CodexSession) => void = () => undefined;
    const session: CodexSession = {
      events: of<CodexEvent>([]),
      ensureThread: async () => ({ threadId: "thr_abort" }),
      startTurn: async () => {
        started += 1;
        return { turnId: "turn_abort" };
      },
      interrupt: async () => undefined,
      respondToApproval: async () => undefined,
      close: async () => {
        closed += 1;
      },
    };
    const controller = new AbortController();
    let opened = false;
    const harness: CodexHarness = {
      probe: async () => ({ installed: true, authed: true }),
      open: () => new Promise((resolve) => {
        opened = true;
        releaseOpen = resolve;
      }),
    };
    const task = collect(runCodexAssistant({
      messages: [{ role: "user", content: "ping" }],
    }, {
      harness,
      prompt: "系统提示",
      cwd: "/work",
      signal: controller.signal,
    }));
    expect(opened).toBe(true);
    controller.abort();
    releaseOpen(session);
    await expect(task).resolves.toEqual([]);
    expect(started).toBe(0);
    expect(closed).toBe(1);
  });

  it("does not open Codex after the session permit was released", async () => {
    let opened = 0;
    const permit = createSessionPermit(() => undefined);
    permit.releaseIfUnclaimed();
    const harness: CodexHarness = {
      probe: async () => ({ installed: true, authed: true }),
      open: async () => {
        opened += 1;
        throw new Error("should not open");
      },
    };
    await expect(collect(runCodexAssistant({
      messages: [{ role: "user", content: "ping" }],
    }, { harness, prompt: "系统提示", permit }))).rejects.toThrow(/请求已结束/);
    expect(opened).toBe(0);
  });

  it("runs Codex in an empty temp directory and removes it afterwards", async () => {
    let cwd = "";
    let names: string[] = ["unread"];
    const harness: CodexHarness = {
      probe: async () => ({ installed: true, authed: true }),
      open: async (opts) => {
        cwd = opts.cwd;
        names = await readdir(opts.cwd);
        expect(opts.cwd).not.toBe(process.cwd());
        expect(opts.cwd.startsWith(tmpdir())).toBe(true);
        expect(opts.sandboxPolicy).toBe("readOnly");
        return scriptedSession("pong");
      },
    };
    const events = await collect(runCodexAssistant({
      messages: [{ role: "user", content: "ping" }],
    }, { harness, prompt: "系统提示" }));
    expect(names).toEqual([]);
    expect(events.map((event) => event.type)).toEqual(["TEXT_MESSAGE_CHUNK"]);
    await expect(stat(cwd)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removes the temp directory when Codex fails to open", async () => {
    let cwd = "";
    const harness: CodexHarness = {
      probe: async () => ({ installed: true, authed: true }),
      open: async (opts) => {
        cwd = opts.cwd;
        throw new Error("open failed");
      },
    };
    await expect(collect(runCodexAssistant({
      messages: [{ role: "user", content: "ping" }],
    }, { harness, prompt: "系统提示" }))).rejects.toThrow(/open failed/);
    expect(cwd.startsWith(tmpdir())).toBe(true);
    await expect(stat(cwd)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not delete a caller-supplied working directory", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nextflow-codex-keep-"));
    await writeFile(join(cwd, "keep.txt"), "stay");
    try {
      const harness: CodexHarness = {
        probe: async () => ({ installed: true, authed: true }),
        open: async (opts) => {
          expect(opts.cwd).toBe(cwd);
          return scriptedSession("pong");
        },
      };
      await collect(runCodexAssistant({
        messages: [{ role: "user", content: "ping" }],
      }, { harness, prompt: "系统提示", cwd }));
      await expect(readdir(cwd)).resolves.toEqual(["keep.txt"]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

function scriptedSession(text: string): CodexSession {
  return {
    events: of<CodexEvent>([
      { type: "text.delta", itemId: "m", delta: text },
      { type: "turn.end", turnId: "turn_scripted", status: "completed" },
    ]),
    ensureThread: async () => ({ threadId: "thr_scripted" }),
    startTurn: async () => ({ turnId: "turn_scripted" }),
    interrupt: async () => undefined,
    respondToApproval: async () => undefined,
    close: async () => undefined,
  };
}

function of<T>(items: readonly T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}
