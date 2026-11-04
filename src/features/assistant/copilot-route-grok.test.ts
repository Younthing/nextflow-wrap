import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { GrokEvent, GrokHarness, GrokOpenOptions } from "@/features/grok-harness";
import { createCopilotRoute } from "./copilot-route";
import { FakeCodexHarness, type FakeCodexStep } from "./fake-codex-harness";

process.env.COPILOTKIT_TELEMETRY_DISABLED = "true";
process.env.SUPPRESS_TRANSFORMATION_WARNINGS = "true";

const originalWarn = console.warn.bind(console);
beforeAll(() => {
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    const text = args.map((part) => String(part)).join(" ");
    if (text.includes("[CopilotKit]") || text.includes("[ag-ui]")) return;
    originalWarn(...args);
  });
});

const ORIGIN = "http://127.0.0.1:3000";

/** A Grok harness backed by the scripted Codex fake. Records Grok open options. */
class FakeGrok implements GrokHarness {
  readonly opens: GrokOpenOptions[] = [];
  constructor(readonly inner: FakeCodexHarness) {}
  probe() {
    return this.inner.probe();
  }
  async open(options: GrokOpenOptions) {
    this.opens.push(options);
    const session = await this.inner.open({ cwd: options.cwd, model: options.model });
    return {
      // The scripted fake only emits text, tool-JSON text, and turn.end.
      events: session.events as AsyncIterable<GrokEvent>,
      ensureSession: async () => ({ sessionId: (await session.ensureThread()).threadId }),
      startTurn: (input: string) => session.startTurn(input),
      interrupt: () => session.interrupt(),
      close: () => session.close(),
    };
  }
}

function headers(json = false): Headers {
  const value = new Headers({ host: "127.0.0.1:3000", origin: ORIGIN, "sec-fetch-site": "same-origin" });
  if (json) value.set("content-type", "application/json");
  return value;
}

function run(content: string, tools: unknown[] = []): Request {
  const threadId = crypto.randomUUID();
  return new Request(`${ORIGIN}/api/copilotkit/agent/default/run`, {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify({
      threadId,
      runId: `run-${threadId}`,
      protocolVersion: "1.0",
      messages: [{ id: crypto.randomUUID(), role: "user", content }],
      tools,
      context: [],
    }),
  });
}

async function events(response: Response): Promise<{ type: string; delta?: string; toolCallName?: string }[]> {
  const raw = await response.text();
  return raw.split("\n").filter((line) => line.startsWith("data:")).map((line) => JSON.parse(line.slice(5).trim()));
}

describe("CopilotKit route with Grok Build", () => {
  const fakes: FakeCodexHarness[] = [];
  afterEach(() => {
    for (const fake of fakes) {
      fake.release();
      fake.releaseProbe();
    }
    fakes.length = 0;
  });

  function setup(env: Record<string, string | undefined>, grokTurns: FakeCodexStep[][], codexProbe = { installed: false }) {
    const codex = new FakeCodexHarness({ probe: codexProbe });
    const grokInner = new FakeCodexHarness({ turns: grokTurns });
    fakes.push(codex, grokInner);
    const grok = new FakeGrok(grokInner);
    const route = createCopilotRoute({ env, harness: codex, grokHarness: grok, cwd: "/work" });
    return { route, codex, grok, grokInner };
  }

  it("COPILOT_BACKEND=grok reports grok in the status endpoint", async () => {
    const { route, codex } = setup({ COPILOT_BACKEND: "grok", GROK_MODEL: "grok-test" }, []);
    const response = await route.GET(new Request(`${ORIGIN}/api/copilotkit/status`, { headers: headers() }));
    await expect(response.json()).resolves.toEqual({ enabled: true, backend: "grok", model: "grok-test" });
    expect(codex.probeCalls).toBe(0);
  });

  it("streams a Grok text turn in the given cwd with permissions rejected", async () => {
    const { route, grok, grokInner } = setup({ COPILOT_BACKEND: "grok" }, [[{ type: "text", text: "你好，来自 Grok" }]]);
    const response = await route.POST(run("你好"));
    expect(response.status).toBe(200);
    const list = await events(response);
    expect(list.filter((event) => event.type.startsWith("TEXT_MESSAGE")).map((event) => event.delta ?? "").join("")).toBe("你好，来自 Grok");
    expect(grok.opens).toEqual([{ cwd: "/work", model: undefined, permission: "reject" }]);
    expect(grokInner.closes).toBe(1);
  });

  it("bridges a Grok tool-JSON reply into an AG-UI tool call", async () => {
    const { route } = setup({ COPILOT_BACKEND: "grok" }, [[{ type: "tool", name: "search_modules", arguments: { query: "fastqc" } }]]);
    const response = await route.POST(run("找 fastqc", [{
      name: "search_modules",
      description: "搜索模块",
      parameters: { type: "object", properties: { query: { type: "string" } } },
    }]));
    const list = await events(response);
    expect(list).toContainEqual(expect.objectContaining({ type: "TOOL_CALL_START", toolCallName: "search_modules" }));
    expect(list).toContainEqual(expect.objectContaining({ type: "TOOL_CALL_ARGS", delta: "{\"query\":\"fastqc\"}" }));
  });

  it("auto picks Grok when Codex is missing, and Codex when it is logged in", async () => {
    const missing = setup({ COPILOT_BACKEND: "auto" }, []);
    const status = await missing.route.GET(new Request(`${ORIGIN}/api/copilotkit/status`, { headers: headers() }));
    await expect(status.json()).resolves.toEqual({ enabled: true, backend: "grok", codex: "not-installed" });

    const codexReady = setup({ COPILOT_BACKEND: "auto" }, [], { installed: true, authed: true } as { installed: boolean });
    const ready = await codexReady.route.GET(new Request(`${ORIGIN}/api/copilotkit/status`, { headers: headers() }));
    await expect(ready.json()).resolves.toEqual({ enabled: true, backend: "codex" });
    expect(codexReady.grokInner.probeCalls).toBe(0);
  });

  it("caps concurrent Grok sessions with GROK_MAX_SESSIONS and names Grok in the 429", async () => {
    const { route } = setup({ COPILOT_BACKEND: "grok", GROK_MAX_SESSIONS: "1" }, [[{ type: "hold" }, { type: "text", text: "ok" }]]);
    const first = await route.POST(run("一"));
    const reading = first.text();
    const second = await route.POST(run("二"));
    expect(second.status).toBe(429);
    await expect(second.json()).resolves.toEqual({ message: "Grok 正在处理的会话已达上限，请稍后再试" });
    fakes[1]!.release();
    await reading;
  });
});
