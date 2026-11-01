import { createServer } from "node:http";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { CODEX_PROBE_TIMEOUT_MS, createCopilotRoute, type CopilotRouteHandlers } from "./copilot-route";
import { FakeCodexHarness } from "./fake-codex-harness";

// CopilotKit posts telemetry unless this is set. Checked when a runtime is constructed.
process.env.COPILOTKIT_TELEMETRY_DISABLED = "true";
// ag-ui warns when it drops fields it does not model on RUN_ERROR. The route still emits them.
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
const KEY = { ANTHROPIC_API_KEY: "sk-test" };
const tools = [{
  name: "search_modules",
  description: "搜索模块",
  parameters: { type: "object", properties: { query: { type: "string" } } },
}];

interface SseEvent {
  type: string;
  delta?: string;
  message?: string;
  toolCallId?: string;
  toolCallName?: string;
  outcome?: { type?: string };
}

function sameOriginHeaders(extra?: Record<string, string>): Headers {
  const headers = new Headers({
    host: "127.0.0.1:3000",
    origin: ORIGIN,
    "sec-fetch-site": "same-origin",
  });
  if (extra) {
    for (const [key, value] of Object.entries(extra)) headers.set(key, value);
  }
  return headers;
}

function get(path: string): Request {
  return new Request(`${ORIGIN}${path}`, { headers: sameOriginHeaders() });
}

function post(path: string, body?: unknown): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: sameOriginHeaders(body === undefined ? undefined : { "content-type": "application/json" }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function user(content: string) {
  return { id: crypto.randomUUID(), role: "user" as const, content };
}

function runBody(
  threadId: string,
  messages: unknown[],
  extra?: {
    tools?: typeof tools;
    context?: { description: string; value: string }[];
    forwardedProps?: Record<string, unknown>;
  },
) {
  return {
    threadId,
    runId: `run-${threadId}`,
    protocolVersion: "1.0",
    messages,
    tools: extra?.tools ?? [],
    context: extra?.context ?? [],
    ...(extra?.forwardedProps ? { forwardedProps: extra.forwardedProps } : {}),
  };
}

function parseSse(body: string): SseEvent[] {
  const events: SseEvent[] = [];
  for (const block of body.split(/\n\n/)) {
    for (const line of block.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const raw = line.startsWith("data: ") ? line.slice(6) : line.slice(5).trim();
      if (!raw || raw === "[DONE]") continue;
      events.push(JSON.parse(raw) as SseEvent);
    }
  }
  return events;
}

async function readEvents(response: Response, ms = 4_000): Promise<SseEvent[]> {
  const reader = response.body?.getReader();
  if (!reader) return parseSse("");
  const decoder = new TextDecoder();
  let raw = "";
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => {});
  }, ms);
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      if (next.value) raw += decoder.decode(next.value, { stream: true });
    }
    raw += decoder.decode();
  } catch (error) {
    if (timedOut) throw new Error("response body timed out", { cause: error });
    throw error;
  } finally {
    clearTimeout(timer);
  }
  if (timedOut) throw new Error("response body timed out");
  return parseSse(raw);
}

function textOf(events: SseEvent[]): string {
  return events
    .filter((event) => event.type === "TEXT_MESSAGE_CONTENT" || event.type === "TEXT_MESSAGE_CHUNK")
    .map((event) => event.delta ?? "")
    .join("");
}

async function waitFor(ready: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function routeFor(harness: FakeCodexHarness, env: Record<string, string | undefined>, probeTimeoutMs?: number): CopilotRouteHandlers {
  return createCopilotRoute({
    env,
    harness,
    cwd: "/work",
    ...(probeTimeoutMs === undefined ? {} : { probeTimeoutMs }),
  });
}

describe("POST /api/copilotkit", () => {
  it("rejects a cross-origin POST before starting a model", async () => {
    const harness = new FakeCodexHarness({ hangProbe: true });
    try {
      const route = routeFor(harness, { COPILOT_BACKEND: "codex" }, 40);
      const response = await route.POST(new Request("http://localhost:3000/api/copilotkit", {
        method: "POST",
        headers: {
          host: "127.0.0.1:3000",
          origin: "https://external.example",
          "sec-fetch-site": "cross-site",
        },
      }));
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ message: "不允许跨站调用 AI 助手" });
      expect(harness.probeCalls).toBe(0);
      expect(harness.opens).toEqual([]);
    } finally {
      harness.releaseProbe();
    }
  });
});

describe("HEAD /api/copilotkit", () => {
  it("does not start a model run", async () => {
    const harness = new FakeCodexHarness({ hangProbe: true });
    try {
      const route = routeFor(harness, { COPILOT_BACKEND: "codex" }, 40);
      const response = await route.HEAD(new Request("http://127.0.0.1:3000/api/copilotkit", {
        method: "HEAD",
        headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin" },
      }));
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("GET, POST, DELETE");
      expect(harness.probeCalls).toBe(0);
      expect(harness.opens).toEqual([]);
    } finally {
      harness.releaseProbe();
    }
  });

  it("rejects a cross-origin HEAD", async () => {
    const harness = new FakeCodexHarness({ hangProbe: true });
    try {
      const route = routeFor(harness, { COPILOT_BACKEND: "codex" }, 40);
      const response = await route.HEAD(new Request("http://127.0.0.1:3000/api/copilotkit", {
        method: "HEAD",
        headers: { host: "127.0.0.1:3000", origin: "https://external.example", "sec-fetch-site": "cross-site" },
      }));
      expect(response.status).toBe(403);
      expect(harness.probeCalls).toBe(0);
    } finally {
      harness.releaseProbe();
    }
  });
});

describe("CopilotKit route with a fake Codex harness", () => {
  const harnesses: FakeCodexHarness[] = [];

  afterEach(() => {
    for (const harness of harnesses) {
      harness.release();
      harness.releaseProbe();
    }
    harnesses.length = 0;
  });

  function use(harness: FakeCodexHarness): FakeCodexHarness {
    harnesses.push(harness);
    return harness;
  }

  it("streams a plain text turn and closes the read-only session", async () => {
    const harness = use(new FakeCodexHarness({
      turns: [[{ type: "text", text: "你好" }, { type: "text", text: "，流程没问题。" }]],
    }));
    const route = routeFor(harness, { COPILOT_BACKEND: "auto", CODEX_MODEL: "gpt-test" });
    const threadId = crypto.randomUUID();
    const response = await route.POST(post("/api/copilotkit/agent/default/run", runBody(
      threadId,
      [user("看一下当前流程")],
      { context: [{ description: "当前流程", value: "{\"nodes\":1}" }] },
    )));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const events = await readEvents(response);
    expect(events[0]).toMatchObject({ type: "RUN_STARTED", threadId });
    expect(textOf(events)).toBe("你好，流程没问题。");
    expect(events.some((event) => event.type === "TEXT_MESSAGE_END")).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "RUN_FINISHED", threadId });
    expect(events.some((event) => event.type.startsWith("TOOL_CALL"))).toBe(false);
    expect(harness.opens).toEqual([expect.objectContaining({
      cwd: "/work",
      model: "gpt-test",
      approvalPolicy: "never",
      sandboxPolicy: "readOnly",
      autoApproval: "decline",
    })]);
    expect(harness.prompts[0]).toContain("看一下当前流程");
    expect(harness.prompts[0]).toContain("当前流程");
    expect(harness.prompts[0]).toContain("Nextflow Studio");
    expect(harness.prompts[0]).toContain("search_modules");
    expect(harness.prompts[0]).toContain("get_task_log");
    expect(harness.closes).toBe(1);
    expect(harness.interrupts).toBe(0);
  });

  it("sends only the named module's prompt", async () => {
    const harness = use(new FakeCodexHarness({
      turns: [[{ type: "text", text: "好" }]],
    }));
    const route = routeFor(harness, { COPILOT_BACKEND: "codex" });
    const response = await route.POST(post("/api/copilotkit/agent/default/run", runBody(
      crypto.randomUUID(),
      [user("这本笔记本怎么标端口")],
      { forwardedProps: { assistantModules: ["notebook", "not-a-module", "notebook"] } },
    )));
    expect(response.status).toBe(200);
    await readEvents(response);
    const prompt = harness.prompts[0] ?? "";
    expect(prompt).toContain("脚本笔记本");
    expect(prompt).toContain("Nextflow Studio");
    expect(prompt).not.toContain("search_modules");
    expect(prompt).not.toContain("get_task_log");
    expect(prompt).not.toContain("发布为模块");
  });

  it("round-trips a browser tool call through the next turn", async () => {
    const harness = use(new FakeCodexHarness({
      turns: [
        [{ type: "tool", name: "search_modules", arguments: { query: "fastqc" } }],
        [{ type: "text", text: "已经加上 FastQC。" }],
      ],
    }));
    const route = routeFor(harness, { COPILOT_BACKEND: "codex" });
    const threadId = crypto.randomUUID();
    const first = await route.POST(post("/api/copilotkit/agent/default/run", runBody(
      threadId,
      [user("加一个 FastQC")],
      { tools },
    )));
    const firstEvents = await readEvents(first);
    const start = firstEvents.find((event) => event.type === "TOOL_CALL_START");
    const args = firstEvents.find((event) => event.type === "TOOL_CALL_ARGS");
    expect(start).toMatchObject({ toolCallName: "search_modules" });
    expect(args?.delta).toBe("{\"query\":\"fastqc\"}");
    expect(firstEvents.some((event) => event.type === "TOOL_CALL_END" && event.toolCallId === start?.toolCallId)).toBe(true);
    expect(textOf(firstEvents)).toBe("");
    expect(firstEvents.at(-1)?.type).toBe("RUN_FINISHED");

    const toolCallId = start?.toolCallId ?? "";
    const second = await route.POST(post("/api/copilotkit/agent/default/run", runBody(
      threadId,
      [
        user("加一个 FastQC"),
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "",
          toolCalls: [{
            id: toolCallId,
            type: "function",
            function: { name: "search_modules", arguments: args?.delta ?? "" },
          }],
        },
        { id: crypto.randomUUID(), role: "tool", toolCallId, content: "{\"moduleId\":\"script/fastq_qc/v1\"}" },
      ],
      { tools },
    )));
    const secondEvents = await readEvents(second);
    expect(textOf(secondEvents)).toBe("已经加上 FastQC。");
    expect(harness.prompts[1]).toContain("script/fastq_qc/v1");
    expect(harness.prompts[1]).toContain("search_modules");
    expect(harness.prompts[1]).toContain("加一个 FastQC");
    expect(harness.opens).toHaveLength(2);
    expect(harness.closes).toBe(2);
  });

  it("cancels a turn in progress through the stop route", async () => {
    const harness = use(new FakeCodexHarness({
      turns: [[{ type: "hold" }]],
    }));
    const route = routeFor(harness, { COPILOT_BACKEND: "auto" });
    const threadId = crypto.randomUUID();
    const response = await route.POST(post("/api/copilotkit/agent/default/run", runBody(threadId, [user("先别回答")])));
    expect(response.status).toBe(200);
    const pending = readEvents(response);
    let events: SseEvent[] = [];
    try {
      await waitFor(() => harness.holds === 1, "the turn to park");
      const stop = await route.POST(post(`/api/copilotkit/agent/default/stop/${threadId}`));
      expect(stop.status).toBe(200);
      await expect(stop.json()).resolves.toMatchObject({
        stopped: true,
        interrupt: { type: "RUN_ERROR", code: "STOPPED" },
      });
      events = await pending;
    } catch (error) {
      harness.release();
      await pending.catch(() => {});
      throw error;
    }
    expect(events[0]).toMatchObject({ type: "RUN_STARTED", threadId });
    expect(events.at(-1)).toMatchObject({
      type: "RUN_FINISHED",
      threadId,
      outcome: { type: "cancelled" },
    });
    expect(harness.interrupts).toBe(1);
    expect(harness.closes).toBe(1);
    expect(harness.prompts[0]).toContain("先别回答");
  });

  it("surfaces a harness open failure and a failed turn on the run stream", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const opened = use(new FakeCodexHarness({ failOpen: "codex binary missing" }));
    const openRoute = routeFor(opened, { COPILOT_BACKEND: "codex" });
    const openEvents = await readEvents(await openRoute.POST(post(
      "/api/copilotkit/agent/default/run",
      runBody(crypto.randomUUID(), [user("ping")]),
    )));
    expect(openEvents.some((event) => event.type === "RUN_ERROR" && event.message === "codex binary missing")).toBe(true);
    expect(opened.opens).toHaveLength(1);
    expect(opened.closes).toBe(0);

    const failed = use(new FakeCodexHarness({
      turns: [[{ type: "fail", message: "模型没有响应" }]],
    }));
    const failEvents = await readEvents(await routeFor(failed, { COPILOT_BACKEND: "codex" }).POST(post(
      "/api/copilotkit/agent/default/run",
      runBody(crypto.randomUUID(), [user("ping")]),
    )));
    expect(failEvents.some((event) => event.type === "RUN_ERROR" && event.message === "模型没有响应")).toBe(true);
    expect(failed.closes).toBe(1);
    errors.mockRestore();
  });
});

describe("CopilotKit backend fallback", () => {
  let apiUrl = "";
  let apiHits = 0;
  let closeApi: () => Promise<void> = async () => {};

  beforeAll(async () => {
    const server = createServer((_req, res) => {
      apiHits += 1;
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "rejected by test" } }));
    });
    server.on("clientError", (_error, socket) => {
      socket.destroy();
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test API server has no port");
    apiUrl = `http://127.0.0.1:${address.port}`;
    closeApi = () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
    vi.stubEnv("ANTHROPIC_BASE_URL", apiUrl);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await closeApi();
  });

  async function expectBuiltinRun(route: CopilotRouteHandlers, harness: FakeCodexHarness) {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const before = apiHits;
    try {
      const events = await readEvents(await route.POST(post(
        "/api/copilotkit/agent/default/run",
        runBody(crypto.randomUUID(), [user("你好")]),
      )));
      const message = events.filter((event) => event.type === "RUN_ERROR").map((event) => event.message).join("\n");
      expect(message).toBe("Unauthorized");
      expect(apiHits).toBeGreaterThan(before);
      expect(harness.opens).toEqual([]);
    } finally {
      errors.mockRestore();
    }
  }

  it("uses the builtin agent and never probes Codex when COPILOT_BACKEND=builtin", async () => {
    const harness = new FakeCodexHarness({ hangProbe: true });
    try {
      const route = routeFor(harness, { COPILOT_BACKEND: "builtin", COPILOT_MODEL: "anthropic/claude-test", ...KEY }, 40);
      const status = await route.GET(get("/api/copilotkit/status"));
      await expect(status.json()).resolves.toEqual({
        enabled: true,
        backend: "builtin",
        model: "anthropic/claude-test",
      });
      const info = await route.GET(get("/api/copilotkit/info"));
      const described = await info.json() as { agents: { default: { className: string } } };
      expect(described.agents.default.className).toBe("BuiltInAgent");
      expect(harness.probeCalls).toBe(0);
      await expectBuiltinRun(route, harness);
      expect(harness.probeCalls).toBe(0);
    } finally {
      harness.releaseProbe();
    }
  });

  it("falls back to builtin when Codex is missing or the probe throws", async () => {
    const missing = new FakeCodexHarness({ probe: { installed: false } });
    const missingRoute = routeFor(missing, { COPILOT_BACKEND: "auto", ...KEY });
    await expect(missingRoute.GET(get("/api/copilotkit/status")).then((res) => res.json())).resolves.toMatchObject({
      enabled: true,
      backend: "builtin",
      codex: "not-installed",
    });
    await expectBuiltinRun(missingRoute, missing);
    expect(missing.probeCalls).toBe(1);

    const broken = new FakeCodexHarness({
      probe: async () => {
        throw new Error("codex app-server closed");
      },
    });
    const brokenRoute = routeFor(broken, { COPILOT_BACKEND: "auto", ...KEY });
    await expect(brokenRoute.GET(get("/api/copilotkit/status")).then((res) => res.json())).resolves.toMatchObject({
      enabled: true,
      backend: "builtin",
      codex: "unavailable",
    });
    await expectBuiltinRun(brokenRoute, broken);
  });

  it("stays on Codex when that backend is required and the harness cannot be used", async () => {
    const missing = new FakeCodexHarness({ probe: { installed: false } });
    const route = routeFor(missing, { COPILOT_BACKEND: "codex", ...KEY });
    await expect(route.GET(get("/api/copilotkit/status")).then((res) => res.json())).resolves.toMatchObject({
      enabled: false,
      backend: "codex",
      reason: "codex-not-installed",
    });
    const denied = await route.POST(post(
      "/api/copilotkit/agent/default/run",
      runBody(crypto.randomUUID(), [user("ping")]),
    ));
    expect(denied.status).toBe(503);
    await expect(denied.json()).resolves.toMatchObject({ reason: "codex-not-installed" });
    expect(missing.opens).toEqual([]);

    const unauthenticated = new FakeCodexHarness({ probe: { installed: true, authed: false } });
    const forced = routeFor(unauthenticated, { COPILOT_BACKEND: "codex" });
    await expect(forced.GET(get("/api/copilotkit/status")).then((res) => res.json())).resolves.toMatchObject({
      enabled: false,
      reason: "codex-unauthenticated",
    });
    expect(unauthenticated.opens).toEqual([]);
  });

  it("applies the probe deadline and does not call Codex again while the result is cached", async () => {
    expect(CODEX_PROBE_TIMEOUT_MS).toBe(8_000);
    const harness = new FakeCodexHarness({ hangProbe: true });
    const forced = new FakeCodexHarness({ hangProbe: true });
    try {
      const started = Date.now();
      const route = routeFor(harness, { COPILOT_BACKEND: "auto", ...KEY }, 40);
      const status = await route.GET(get("/api/copilotkit/status"));
      expect(Date.now() - started).toBeLessThan(1_000);
      await expect(status.json()).resolves.toMatchObject({
        enabled: true,
        backend: "builtin",
        codex: "unavailable",
      });
      expect(harness.probeCalls).toBe(1);
      await expect(route.GET(get("/api/copilotkit/status")).then((res) => res.json())).resolves.toMatchObject({
        backend: "builtin",
        codex: "unavailable",
      });
      expect(harness.probeCalls).toBe(1);
      await expectBuiltinRun(route, harness);
      expect(harness.probeCalls).toBe(1);

      const forcedStarted = Date.now();
      const codex = routeFor(forced, { COPILOT_BACKEND: "codex", ...KEY }, 40);
      const denied = await codex.POST(post(
        "/api/copilotkit/agent/default/run",
        runBody(crypto.randomUUID(), [user("ping")]),
      ));
      expect(Date.now() - forcedStarted).toBeLessThan(1_000);
      expect(denied.status).toBe(503);
      await expect(denied.json()).resolves.toMatchObject({ reason: "codex-unavailable" });
      expect(forced.opens).toEqual([]);
    } finally {
      harness.releaseProbe();
      forced.releaseProbe();
    }
  });
});
