import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { runGrokAssistant } from "../src/features/assistant/grok-agent";
import type { CodexAguiEvent } from "../src/features/assistant/codex-turn";
import { createGrokHarness, GrokHarnessError, type GrokSession } from "../src/features/grok-harness";

const DEFAULT_PROMPT = "Reply with the single word pong.";
const TIMEOUT_MS = 120_000;

function usage(): string {
  return [
    "Usage: pnpm grok:smoke [--model <id>] [--binary <path>] [--skip-bridge] [-- <prompt>]",
    "",
    "Runs real turns on the local Grok Build CLI over ACP (`grok agent stdio`).",
    "`grok login` must already be done (or XAI_API_KEY set). Auth stays in ~/.grok;",
    "this script never reads or copies tokens.",
    "",
    "1. harness turn: one prompt in an empty temp directory, must stream text.",
    "2. bridge turn: the assistant layer with one fake browser tool, must emit an AG-UI tool call.",
    "",
    "Both use the chat agent profile (no host tools), GROK_SANDBOX=strict, and reject permission prompts.",
    "If `grok` is not on PATH, the script skips and exits 0.",
  ].join("\n");
}

interface Args {
  model?: string;
  binary?: string;
  skipBridge: boolean;
  prompt: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { skipBridge: false, prompt: "" };
  const prompt: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      prompt.push(...argv.slice(index + 1));
      break;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--skip-bridge") {
      args.skipBridge = true;
      continue;
    }
    if (arg === "--model" || arg === "--binary") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      if (arg === "--model") args.model = value;
      else args.binary = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) throw new Error(`Unknown flag ${arg}\n${usage()}`);
    prompt.push(arg);
  }
  args.prompt = prompt.join(" ").trim() || DEFAULT_PROMPT;
  return args;
}

async function readTurn(session: GrokSession): Promise<{ text: string; hostTools: string[] }> {
  let text = "";
  const hostTools: string[] = [];
  for await (const event of session.events) {
    if (event.type === "text.delta") {
      text += event.delta;
      process.stdout.write(event.delta);
    } else if (event.type === "tool.started") {
      hostTools.push(event.tool);
      process.stderr.write(`\n[grok tool] ${event.title ?? event.tool}\n`);
    } else if (event.type === "approval.request") {
      process.stderr.write(`\n[permission rejected] ${event.detail ?? ""}\n`);
    } else if (event.type === "error") {
      process.stderr.write(`\n[error] ${event.message}\n`);
    } else if (event.type === "turn.end") {
      process.stdout.write("\n");
      if (event.status !== "completed") throw new GrokHarnessError(`turn ended with ${event.status}`);
      return { text, hostTools };
    }
  }
  throw new GrokHarnessError("grok session closed before the turn ended");
}

async function harnessTurn(args: Args): Promise<void> {
  const harness = createGrokHarness({ binaryPath: args.binary });
  const cwd = await mkdtemp(join(tmpdir(), "nextflow-grok-smoke-"));
  let session: GrokSession | undefined;
  try {
    const started = Date.now();
    session = await harness.open({ cwd, model: args.model });
    const { sessionId } = await session.ensureSession();
    const reading = readTurn(session);
    const { turnId } = await session.startTurn(args.prompt);
    console.error(`session ${sessionId} turn ${turnId}`);
    const result = await reading;
    if (!result.text.trim()) throw new GrokHarnessError("harness turn returned no text");
    console.log(JSON.stringify({ step: "harness", ok: true, chars: result.text.length, hostTools: result.hostTools, ms: Date.now() - started }));
  } finally {
    await session?.close();
    await rm(cwd, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function bridgeTurn(args: Args): Promise<void> {
  const harness = createGrokHarness({ binaryPath: args.binary });
  const started = Date.now();
  const events: CodexAguiEvent[] = [];
  for await (const event of runGrokAssistant(
    {
      messages: [{ role: "user", content: "我的笔记本里有哪些单元格？请先读取笔记本结构。" }],
      tools: [{
        name: "get_notebook_summary",
        description: "读取当前笔记本的单元格列表和摘要。",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      }],
    },
    { harness, prompt: "你是 nextflow-wrap 的助手。", model: args.model },
  )) {
    events.push(event);
  }
  const call = events.find((event) => event.type === "TOOL_CALL_START");
  const text = events.filter((event) => event.type === "TEXT_MESSAGE_CHUNK").map((event) => event.delta).join("");
  if (!call || call.toolCallName !== "get_notebook_summary") {
    throw new GrokHarnessError(`bridge turn did not emit the tool call (text: ${text.slice(0, 200)})`);
  }
  const args_ = events.find((event) => event.type === "TOOL_CALL_ARGS");
  console.log(JSON.stringify({
    step: "bridge",
    ok: true,
    tool: call.toolCallName,
    arguments: args_?.type === "TOOL_CALL_ARGS" ? args_.delta : undefined,
    ms: Date.now() - started,
  }));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const probe = await createGrokHarness({ binaryPath: args.binary }).probe();
  console.log(JSON.stringify({ installed: probe.installed, authed: probe.authed, models: probe.models }, null, 2));
  if (!probe.installed) {
    console.log("grok is not on PATH; smoke skipped. Install Grok Build and run `grok login`.");
    return;
  }
  if (probe.authed === false) {
    throw new GrokHarnessError("grok is installed but not authenticated. Run `grok login`. This script does not read ~/.grok.");
  }
  const timer = setTimeout(() => {
    console.error(`smoke timed out after ${TIMEOUT_MS}ms`);
    process.exit(1);
  }, TIMEOUT_MS);
  timer.unref();
  try {
    await harnessTurn(args);
    if (!args.skipBridge) await bridgeTurn(args);
  } finally {
    clearTimeout(timer);
  }
}

function isEntrypoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isEntrypoint()) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
