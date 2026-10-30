import { afterEach, describe, expect, it } from "vitest";

import { AsyncQueue } from "@/features/codex-harness/async-queue";
import { createCodexHarness } from "@/features/codex-harness/harness";
import type { CodexChild, CodexChildExit, CodexSpawnSpec } from "@/features/codex-harness/process";
import type { CodexEvent, CodexSession } from "@/features/codex-harness/types";

interface Wire {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code?: number; message?: string };
}

class ScriptedChild implements CodexChild {
  readonly received: Wire[] = [];
  handlerError: unknown;
  private readonly stdout = new AsyncQueue<string>();
  private readonly stdin = new AsyncQueue<string>();
  private spawnFailure: NodeJS.ErrnoException | undefined;
  private settled = false;
  private resolveExit!: (value: CodexChildExit) => void;
  readonly exited: Promise<CodexChildExit>;
  private closing: Promise<void> | undefined;

  constructor(readonly args: string[], readonly cwd?: string) {
    this.exited = new Promise((resolve) => {
      this.resolveExit = resolve;
    });
  }

  writeLine(line: string): void {
    this.received.push(JSON.parse(line) as Wire);
    this.stdin.push(line);
  }

  lines(): AsyncIterable<string> {
    return this.stdout;
  }

  stderrTail(): string {
    return "";
  }

  spawnError(): NodeJS.ErrnoException | undefined {
    return this.spawnFailure;
  }

  emit(line: string): void {
    this.stdout.push(line);
  }

  finish(code: number | null): void {
    if (this.settled) return;
    this.settled = true;
    this.stdout.close();
    this.stdin.close();
    this.resolveExit({ code, signal: null });
  }

  failSpawn(code: string): void {
    const error = new Error(`spawn ${code}`) as NodeJS.ErrnoException;
    error.code = code;
    this.spawnFailure = error;
    this.finish(null);
  }

  close(): Promise<void> {
    this.closing ??= Promise.resolve().then(() => this.finish(0));
    return this.closing;
  }

  async eachInput(handle: (message: Wire) => void | Promise<void>): Promise<void> {
    try {
      for await (const line of this.stdin) await handle(JSON.parse(line) as Wire);
    } catch (error) {
      this.handlerError = error;
    }
  }
}

const children: ScriptedChild[] = [];

afterEach(() => {
  const errors = children.flatMap((child) => (child.handlerError ? [child.handlerError] : []));
  children.splice(0);
  if (errors[0]) throw errors[0];
});

function rpc(message: Wire): string {
  return JSON.stringify(message);
}

function createFake(onMessage: (child: ScriptedChild, message: Wire) => void | Promise<void>) {
  const specs: CodexSpawnSpec[] = [];
  const harness = createCodexHarness({
    requestTimeoutMs: 1_000,
    spawn(spec) {
      specs.push({ binaryPath: spec.binaryPath, args: [...spec.args], cwd: spec.cwd });
      const child = new ScriptedChild(spec.args, spec.cwd);
      children.push(child);
      if (spec.args[0] === "--version") {
        child.emit("codex-cli 0.0.0-test");
        child.finish(0);
        return child;
      }
      void child.eachInput(async (message) => {
        if (message.method === "initialize" && message.id !== undefined) {
          child.emit(rpc({ id: message.id, result: { userAgent: "codex/test" } }));
          return;
        }
        if (message.method === "initialized") return;
        await onMessage(child, message);
      });
      return child;
    },
  });
  return { harness, specs };
}

async function takeUntil(session: CodexSession, stop: (event: CodexEvent) => boolean): Promise<CodexEvent[]> {
  const events: CodexEvent[] = [];
  for await (const event of session.events) {
    events.push(event);
    if (stop(event)) return events;
  }
  return events;
}

function replyThread(child: ScriptedChild, message: Wire, threadId = "thr_123"): void {
  child.emit(rpc({ id: message.id, result: { thread: { id: threadId } } }));
}

describe("codex harness", () => {
  it("runs initialize, thread/start, turn/start, and streams the turn", async () => {
    const { harness, specs } = createFake((child, message) => {
      if (message.method === "thread/start") replyThread(child, message);
      if (message.method === "turn/start") {
        child.emit(rpc({ id: message.id, result: { turn: { id: "turn_456", status: "inProgress", items: [], error: null } } }));
        child.emit(rpc({
          method: "item/agentMessage/delta",
          params: { threadId: "thr_123", turnId: "turn_456", itemId: "item_1", delta: "Hello" },
        }));
        child.emit(rpc({
          method: "turn/completed",
          params: { turn: { id: "turn_456", status: "completed", items: [] } },
        }));
      }
    });

    const session = await harness.open({
      cwd: "/work/pipeline",
      model: "gpt-test",
      approvalPolicy: "never",
      sandboxPolicy: "read-only",
      binaryPath: "/opt/codex",
    });
    const collected = takeUntil(session, (event) => event.type === "turn.end");
    await expect(session.ensureThread()).resolves.toEqual({ threadId: "thr_123" });
    await expect(session.ensureThread()).resolves.toEqual({ threadId: "thr_123" });
    await expect(session.startTurn("Summarize the workflow")).resolves.toEqual({ turnId: "turn_456" });

    await expect(collected).resolves.toEqual([
      { type: "text.delta", itemId: "item_1", turnId: "turn_456", delta: "Hello" },
      { type: "turn.end", turnId: "turn_456", status: "completed" },
    ]);

    const child = children[0];
    expect(specs).toEqual([{ binaryPath: "/opt/codex", args: ["app-server"], cwd: "/work/pipeline" }]);
    expect(child.received.map((message) => message.method)).toEqual([
      "initialize",
      "initialized",
      "thread/start",
      "turn/start",
    ]);
    expect(child.received.every((message) => !("jsonrpc" in message))).toBe(true);
    expect(child.received[0]).toMatchObject({
      method: "initialize",
      params: { clientInfo: { name: "nextflow_wrap", title: "Nextflow Studio", version: "0.1.0" } },
    });
    expect(child.received[2]?.params).toMatchObject({
      cwd: "/work/pipeline",
      model: "gpt-test",
      approvalPolicy: "never",
      sandbox: "readOnly",
      serviceName: "nextflow-wrap",
    });
    expect(child.received[3]?.params).toMatchObject({
      threadId: "thr_123",
      input: [{ type: "text", text: "Summarize the workflow" }],
      cwd: "/work/pipeline",
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly" },
      model: "gpt-test",
    });
    expect(child.received.filter((message) => message.method === "thread/start")).toHaveLength(1);
    await session.close();
    await session.close();
  });

  it("starts the thread from startTurn and uses the default policies", async () => {
    const { harness } = createFake((child, message) => {
      if (message.method === "thread/start") replyThread(child, message);
      if (message.method === "turn/start") {
        child.emit(rpc({ id: message.id, result: { turn: { id: "turn_1", status: "inProgress" } } }));
        child.emit(rpc({ method: "turn/completed", params: { turn: { id: "turn_1", status: "completed" } } }));
      }
    });
    const session = await harness.open({ cwd: "/work" });
    const collected = takeUntil(session, (event) => event.type === "turn.end");
    await session.startTurn("ping");
    await collected;
    expect(children[0].received.map((message) => message.method)).toEqual([
      "initialize",
      "initialized",
      "thread/start",
      "turn/start",
    ]);
    expect(children[0].received[2]?.params).toMatchObject({
      approvalPolicy: "onRequest",
      sandbox: "workspaceWrite",
    });
    expect(children[0].received[3]?.params).toMatchObject({
      sandboxPolicy: { type: "workspaceWrite" },
      approvalPolicy: "onRequest",
    });
    await session.close();

    const aliased = await harness.open({
      cwd: "/work",
      approvalPolicy: "on-request",
      sandboxPolicy: "workspace-write",
    });
    await aliased.ensureThread();
    const thread = children[1].received.find((message) => message.method === "thread/start");
    expect(thread?.params).toMatchObject({ approvalPolicy: "onRequest", sandbox: "workspaceWrite" });
    await aliased.close();
  });

  it("streams tool output and a failed turn", async () => {
    const { harness } = createFake((child, message) => {
      if (message.method === "thread/start") replyThread(child, message);
      if (message.method === "turn/start") {
        child.emit(rpc({ id: message.id, result: { turn: { id: "turn_9", status: "inProgress" } } }));
        child.emit(rpc({
          method: "error",
          params: { willRetry: true, turnId: "turn_9", error: { message: "retrying" } },
        }));
        child.emit(rpc({
          method: "item/started",
          params: { turnId: "turn_9", item: { id: "item_collab", type: "collabAgentToolCall", tool: "spawn" } },
        }));
        child.emit(rpc({
          method: "item/started",
          params: {
            turnId: "turn_9",
            item: { id: "item_cmd", type: "commandExecution", command: "npm test", status: "inProgress" },
          },
        }));
        child.emit(rpc({
          method: "item/commandExecution/outputDelta",
          params: { turnId: "turn_9", itemId: "item_cmd", delta: "ok\n" },
        }));
        child.emit(rpc({
          method: "item/completed",
          params: {
            turnId: "turn_9",
            item: { id: "item_cmd", type: "commandExecution", command: "npm test", status: "completed" },
          },
        }));
        child.emit("{");
        child.emit(rpc({
          method: "turn/completed",
          params: { turn: { id: "turn_9", status: "failed", error: { message: "boom" } } },
        }));
      }
    });
    const session = await harness.open({ cwd: "/work" });
    const collected = takeUntil(session, (event) => event.type === "turn.end");
    await session.startTurn("run tests");
    await expect(collected).resolves.toEqual([
      { type: "tool.started", itemId: "item_collab", tool: "collabAgentToolCall", turnId: "turn_9", title: "spawn" },
      { type: "tool.started", itemId: "item_cmd", tool: "commandExecution", turnId: "turn_9", title: "npm test" },
      { type: "tool.delta", itemId: "item_cmd", delta: "ok\n", turnId: "turn_9" },
      { type: "tool.completed", itemId: "item_cmd", tool: "commandExecution", turnId: "turn_9", status: "completed" },
      { type: "error", message: "Received invalid JSON from codex app-server" },
      { type: "error", message: "boom", turnId: "turn_9" },
      { type: "turn.end", turnId: "turn_9", status: "failed" },
    ]);
    await session.close();
  });

  it("declines command approvals unless the caller answers them", async () => {
    const seen: Wire[] = [];
    const { harness } = createFake((child, message) => {
      if (message.method === "thread/start") replyThread(child, message);
      if (message.method === "turn/start") {
        child.emit(rpc({ id: message.id, result: { turn: { id: "turn_2", status: "inProgress" } } }));
        child.emit(rpc({
          id: 99,
          method: "item/commandExecution/requestApproval",
          params: { threadId: "thr_123", turnId: "turn_2", itemId: "item_cmd", command: "rm -rf /tmp/demo" },
        }));
      }
      if (message.id === 99) {
        seen.push(message);
        child.emit(rpc({ method: "turn/completed", params: { turn: { id: "turn_2", status: "completed" } } }));
      }
    });
    const session = await harness.open({ cwd: "/work" });
    const collected = takeUntil(session, (event) => event.type === "turn.end");
    await session.startTurn("clean the scratch dir");
    await expect(collected).resolves.toEqual([
      {
        type: "approval.request",
        requestId: "99",
        method: "item/commandExecution/requestApproval",
        threadId: "thr_123",
        turnId: "turn_2",
        itemId: "item_cmd",
        detail: "rm -rf /tmp/demo",
      },
      { type: "turn.end", turnId: "turn_2", status: "completed" },
    ]);
    expect(seen.map((message) => message.result)).toEqual([{ decision: "decline" }]);
    await expect(session.respondToApproval("99", "accept")).rejects.toThrow(/no pending approval/);
    await session.close();
  });

  it("forwards a manual approval decision", async () => {
    const seen: Wire[] = [];
    const { harness } = createFake((child, message) => {
      if (message.method === "thread/start") replyThread(child, message);
      if (message.method === "turn/start") {
        child.emit(rpc({ id: message.id, result: { turn: { id: "turn_3", status: "inProgress" } } }));
        child.emit(rpc({
          id: "apr_1",
          method: "item/fileChange/requestApproval",
          params: { threadId: "thr_123", turnId: "turn_3", itemId: "item_file", reason: "edit main.nf" },
        }));
      }
      if (message.id === "apr_1") {
        seen.push(message);
        child.emit(rpc({ method: "turn/completed", params: { turn: { id: "turn_3", status: "completed" } } }));
      }
    });
    const session = await harness.open({ cwd: "/work", autoApproval: "manual" });
    const requested = takeUntil(session, (event) => event.type === "approval.request");
    await session.startTurn("edit the workflow");
    const [approval] = await requested;
    if (approval?.type !== "approval.request") throw new Error("missing approval");
    await session.respondToApproval(approval.requestId, "accept");
    await expect(takeUntil(session, (event) => event.type === "turn.end")).resolves.toEqual([
      { type: "turn.end", turnId: "turn_3", status: "completed" },
    ]);
    expect(seen).toEqual([{ id: "apr_1", result: { decision: "accept" } }]);
    await session.close();
  });

  it("interrupts the active turn", async () => {
    const { harness } = createFake((child, message) => {
      if (message.method === "thread/start") replyThread(child, message);
      if (message.method === "turn/start") {
        child.emit(rpc({ id: message.id, result: { turn: { id: "turn_4", status: "inProgress" } } }));
      }
      if (message.method === "turn/interrupt") {
        child.emit(rpc({ id: message.id, result: {} }));
        child.emit(rpc({ method: "turn/completed", params: { turn: { id: "turn_4", status: "interrupted" } } }));
      }
    });
    const session = await harness.open({ cwd: "/work" });
    await session.ensureThread();
    const finished = takeUntil(session, (event) => event.type === "turn.end");
    await session.startTurn("keep going");
    await session.interrupt();
    await expect(finished).resolves.toEqual([{ type: "turn.end", turnId: "turn_4", status: "interrupted" }]);
    expect(children[0].received.find((message) => message.method === "turn/interrupt")?.params).toEqual({
      threadId: "thr_123",
      turnId: "turn_4",
    });
    await session.close();
  });

  it("answers unknown server requests so the peer cannot hang", async () => {
    const seen: Wire[] = [];
    const { harness } = createFake((child, message) => {
      if (message.method === "thread/start") replyThread(child, message);
      if (message.method === "turn/start") {
        child.emit(rpc({ id: message.id, result: { turn: { id: "turn_5", status: "inProgress" } } }));
        child.emit(rpc({ id: 5, method: "item/tool/call", params: { name: "mystery" } }));
      }
      if (message.id === 5) {
        seen.push(message);
        child.emit(rpc({ method: "turn/completed", params: { turn: { id: "turn_5", status: "completed" } } }));
      }
    });
    const session = await harness.open({ cwd: "/work" });
    const finished = takeUntil(session, (event) => event.type === "turn.end");
    await session.startTurn("go");
    await finished;
    expect(seen[0]?.error).toMatchObject({ code: -32601 });
    await session.close();
  });

  it("probes the CLI without starting a thread or touching auth material", async () => {
    const { harness, specs } = createFake((child, message) => {
      if (message.method === "account/read") {
        child.emit(rpc({
          id: message.id,
          result: { account: { type: "chatgpt", email: "hidden@example.com" }, requiresOpenaiAuth: true },
        }));
      }
      if (message.method === "model/list") {
        child.emit(rpc({ id: message.id, result: { data: [{ id: "gpt-test", model: "gpt-test" }], nextCursor: null } }));
      }
    });
    await expect(harness.probe()).resolves.toEqual({ installed: true, authed: true, models: ["gpt-test"] });
    expect(specs.map((spec) => spec.args)).toEqual([["--version"], ["app-server"]]);
    const app = children[1];
    expect(app.received.map((message) => message.method)).toEqual([
      "initialize",
      "initialized",
      "account/read",
      "model/list",
    ]);
    expect(app.received.find((message) => message.method === "account/read")?.params).toEqual({ refreshToken: false });
    expect(JSON.stringify(app.received)).not.toContain("auth.json");
    expect(JSON.stringify(app.received)).not.toContain("hidden@example.com");
    await expect(app.exited).resolves.toMatchObject({ code: 0 });
  });

  it("reports a missing binary and an unauthenticated account", async () => {
    const calls: string[][] = [];
    const missing = createCodexHarness({
      spawn(spec) {
        calls.push([...spec.args]);
        const child = new ScriptedChild(spec.args);
        children.push(child);
        child.failSpawn("ENOENT");
        return child;
      },
    });
    await expect(missing.probe()).resolves.toEqual({ installed: false });
    expect(calls).toEqual([["--version"]]);

    const { harness } = createFake((child, message) => {
      if (message.method === "account/read") {
        child.emit(rpc({ id: message.id, result: { account: null, requiresOpenaiAuth: true } }));
      }
      if (message.method === "model/list") {
        child.emit(rpc({ id: message.id, error: { code: -32601, message: "unknown method" } }));
      }
    });
    await expect(harness.probe()).resolves.toEqual({ installed: true, authed: false });
  });

  it("reports installed when the handshake fails and still skips thread/start", async () => {
    const { harness } = createFake((child, message) => {
      if (message.method === "account/read") {
        child.emit(rpc({ id: message.id, error: { code: 1, message: "unavailable" } }));
      }
    });
    await expect(harness.probe()).resolves.toEqual({ installed: true });
    expect(children[1].received.map((message) => message.method)).not.toContain("thread/start");
  });

  it("closes the child when initialize fails", async () => {
    const harness = createCodexHarness({
      requestTimeoutMs: 1_000,
      spawn(spec) {
        const child = new ScriptedChild(spec.args, spec.cwd);
        children.push(child);
        void child.eachInput((message) => {
          if (message.method === "initialize") {
            child.emit(rpc({ id: message.id, error: { code: 1, message: "nope" } }));
          }
        });
        return child;
      },
    });
    await expect(harness.open({ cwd: "/work" })).rejects.toThrow(/initialize failed: nope/);
    await expect(children[0].exited).resolves.toMatchObject({ code: 0 });
  });

  it("rejects an empty turn and a blank cwd", async () => {
    const { harness } = createFake((child, message) => {
      if (message.method === "thread/start") replyThread(child, message);
    });
    await expect(harness.open({ cwd: "  " })).rejects.toThrow(/cwd is required/);
    const session = await harness.open({ cwd: "/work" });
    await expect(session.startTurn("   ")).rejects.toThrow(/turn input is empty/);
    await expect(session.interrupt()).rejects.toThrow(/no active turn/);
    const done = (async () => {
      const events: CodexEvent[] = [];
      for await (const event of session.events) events.push(event);
      return events;
    })();
    await session.close();
    await expect(done).resolves.toEqual([]);
    await expect(session.startTurn("again")).rejects.toThrow(/closed/);
  });
});
