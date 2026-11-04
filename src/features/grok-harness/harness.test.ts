import { describe, expect, it } from "vitest";

import type { CodexSpawnSpec } from "@/features/codex-harness/process";
import { FakeAcpAgent, type FakeAcpScript } from "./fake-acp-agent";
import { createGrokHarness, isAuthRequired } from "./harness";
import { GrokHarnessError } from "./errors";
import { CHAT_AGENT_PROFILE } from "./profile";
import { turnStatus } from "./session";
import type { GrokEvent, GrokSession } from "./types";

function harnessWith(script: FakeAcpScript, env: Record<string, string> = { PATH: "/bin" }) {
  const children: FakeAcpAgent[] = [];
  const harness = createGrokHarness({
    env: env as NodeJS.ProcessEnv,
    requestTimeoutMs: 1_000,
    spawn: (spec: CodexSpawnSpec) => {
      const child = new FakeAcpAgent(spec, script);
      children.push(child);
      return child;
    },
  });
  return { harness, children };
}

async function collectTurn(session: GrokSession, input: string): Promise<GrokEvent[]> {
  const events: GrokEvent[] = [];
  const reading = (async () => {
    for await (const event of session.events) {
      events.push(event);
      if (event.type === "turn.end") break;
    }
  })();
  await session.startTurn(input);
  await reading;
  return events;
}

describe("createGrokHarness.open", () => {
  it("speaks JSON-RPC 2.0 NDJSON and streams one turn as text deltas", async () => {
    const { harness, children } = harnessWith({ chunks: ["po", "ng"] });
    const session = await harness.open({ cwd: "/tmp/empty", model: "grok-test" });
    const events = await collectTurn(session, "Reply with pong");
    await session.close();

    const child = children[0]!;
    expect(child.received.every((frame) => frame.jsonrpc === "2.0")).toBe(true);
    expect(child.received.map((frame) => frame.method)).toEqual(["initialize", "session/new", "session/prompt"]);
    expect(child.received[0]!.params).toMatchObject({
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    });
    expect(child.received[1]!.params).toEqual({ cwd: "/tmp/empty", mcpServers: [] });
    expect(child.received[2]!.params).toEqual({ sessionId: "sess-1", prompt: [{ type: "text", text: "Reply with pong" }] });

    const text = events.filter((event) => event.type === "text.delta").map((event) => event.type === "text.delta" ? event.delta : "");
    expect(text.join("")).toBe("pong");
    expect(events.at(-1)).toMatchObject({ type: "turn.end", status: "completed" });
    // Thought chunks are not shown as reply text.
    expect(text).not.toContain("thinking");
  });

  it("starts a chat-only, sandboxed agent without always-approve, in the given cwd", async () => {
    const { harness, children } = harnessWith({ chunks: ["ok"] }, { PATH: "/bin", GROK_SANDBOX: "off" });
    const session = await harness.open({ cwd: "/tmp/empty", model: "grok-fast" });
    await session.close();
    const spec = children[0]!.spec;
    expect(spec.binaryPath).toBe("grok");
    expect(spec.cwd).toBe("/tmp/empty");
    expect(spec.args[0]).toBe("agent");
    expect(spec.args).toContain("--no-leader");
    expect(spec.args).not.toContain("--always-approve");
    expect(spec.args).not.toContain("--yolo");
    expect(spec.args.slice(-3)).toEqual(["--model", "grok-fast", "stdio"]);
    expect(spec.args[spec.args.indexOf("--agent-profile") + 1]).toMatch(/nextflow-grok-profile-.*chat-agent\.md$/);
    // The harness forces its sandbox over an inherited GROK_SANDBOX.
    expect(spec.env?.GROK_SANDBOX).toBe("strict");
  });

  it("rejects permission prompts so host tools do not run", async () => {
    const { harness, children } = harnessWith({ askPermission: true, chunks: ["done"] });
    const session = await harness.open({ cwd: "/tmp/empty" });
    const events = await collectTurn(session, "delete everything");
    await session.close();
    const answer = children[0]!.received.find((frame) => frame.id === 1000);
    expect(answer?.result).toEqual({ outcome: { outcome: "selected", optionId: "deny" } });
    expect(events).toContainEqual(expect.objectContaining({ type: "approval.request", requestId: "call-1", detail: "Execute `rm -rf /`" }));
    expect(events).toContainEqual(expect.objectContaining({ type: "tool.started", tool: "run_terminal_command" }));
    expect(events).toContainEqual(expect.objectContaining({ type: "tool.completed", status: "failed" }));
  });

  it("answers the cancelled outcome when permission is cancel", async () => {
    const { harness, children } = harnessWith({ askPermission: true, chunks: ["done"] });
    const session = await harness.open({ cwd: "/tmp/empty", permission: "cancel" });
    await collectTurn(session, "x");
    await session.close();
    expect(children[0]!.received.find((frame) => frame.id === 1000)?.result).toEqual({ outcome: { outcome: "cancelled" } });
  });

  it("answers unknown agent requests with method-not-found instead of hanging", async () => {
    const { harness, children } = harnessWith({ unknownRequest: "fs/read_text_file", chunks: ["ok"] });
    const session = await harness.open({ cwd: "/tmp/empty" });
    const events = await collectTurn(session, "x");
    await session.close();
    expect(children[0]!.received.find((frame) => frame.id === 1000)?.error).toMatchObject({ code: -32601 });
    expect(events.at(-1)).toMatchObject({ type: "turn.end", status: "completed" });
  });

  it("interrupt sends session/cancel and the turn ends interrupted", async () => {
    const { harness, children } = harnessWith({ holdUntilCancel: true, chunks: ["partial"] });
    const session = await harness.open({ cwd: "/tmp/empty" });
    const events: GrokEvent[] = [];
    const reading = (async () => {
      for await (const event of session.events) {
        events.push(event);
        if (event.type === "text.delta") await session.interrupt();
        if (event.type === "turn.end") break;
      }
    })();
    await session.startTurn("long task");
    await reading;
    await session.close();
    expect(children[0]!.received.map((frame) => frame.method)).toContain("session/cancel");
    expect(events.at(-1)).toMatchObject({ type: "turn.end", status: "interrupted" });
  });

  it("closes the event stream when the process exits mid-turn", async () => {
    const { harness, children } = harnessWith({ holdUntilCancel: true });
    const session = await harness.open({ cwd: "/tmp/empty" });
    const events: GrokEvent[] = [];
    const reading = (async () => {
      for await (const event of session.events) events.push(event);
    })();
    await session.startTurn("x");
    await children[0]!.close();
    await reading;
    await session.close();
    expect(events.some((event) => event.type === "turn.end" && event.status === "completed")).toBe(false);
  });

  it("requires a cwd", async () => {
    const { harness } = harnessWith({});
    await expect(harness.open({ cwd: " " })).rejects.toThrow("cwd is required");
  });
});

describe("createGrokHarness.probe", () => {
  it("reports installed, authenticated and models without prompting", async () => {
    const { harness, children } = harnessWith({});
    await expect(harness.probe()).resolves.toEqual({ installed: true, authed: true, models: ["grok-test", "grok-fast"] });
    expect(children[0]!.spec.args).toEqual(["--version"]);
    const methods = children[1]!.received.map((frame) => frame.method);
    expect(methods).toEqual(["initialize", "session/new", "session/close"]);
    expect(methods).not.toContain("session/prompt");
  });

  it("reports a logged-out CLI from session/new -32000", async () => {
    const { harness } = harnessWith({ unauthenticated: true });
    await expect(harness.probe()).resolves.toMatchObject({ installed: true, authed: false });
  });

  it("reports a missing binary as not installed", async () => {
    const { harness, children } = harnessWith({ missing: true, versionCode: 127 });
    await expect(harness.probe()).resolves.toEqual({ installed: false });
    expect(children).toHaveLength(1);
  });
});

describe("helpers", () => {
  it("maps ACP stop reasons to turn statuses", () => {
    expect(turnStatus("end_turn")).toBe("completed");
    expect(turnStatus("cancelled")).toBe("interrupted");
    expect(turnStatus("max_tokens")).toBe("max_tokens");
    expect(turnStatus(undefined)).toBe("failed");
  });

  it("recognizes auth-required errors", () => {
    expect(isAuthRequired(new GrokHarnessError("session/new: Authentication required", { code: -32000 }))).toBe(true);
    expect(isAuthRequired(new GrokHarnessError("session/new: boom", { code: -32603 }))).toBe(false);
    expect(isAuthRequired(new Error("Authentication required"))).toBe(false);
  });

  it("limits the chat profile to a harmless tool", () => {
    expect(CHAT_AGENT_PROFILE).toMatch(/^---\nname: nextflow-wrap-chat\n/);
    expect(CHAT_AGENT_PROFILE).toContain("\ntools: todo_write\n");
  });
});
