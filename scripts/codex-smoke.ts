import { createCodexHarness, CodexHarnessError, type CodexSession } from "../src/features/codex-harness";

const DEFAULT_PROMPT = "Reply with the single word pong.";
const TIMEOUT_MS = 90_000;

function usage(): string {
  return [
    "Usage: pnpm codex:smoke [--model <id>] [--binary <path>] [--approval <policy>] [-- <prompt>]",
    "",
    "Runs one Codex turn with the local `codex` CLI (`codex login` must already be done).",
    "Auth stays in ~/.codex. This script never reads or copies tokens.",
    "If `codex` is not on PATH, the script skips and exits 0.",
  ].join("\n");
}

function parseArgs(argv: string[]): { model?: string; binary?: string; approval?: string; prompt: string } {
  let model: string | undefined;
  let binary: string | undefined;
  let approval: string | undefined;
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
    if (arg === "--model" || arg === "--binary" || arg === "--approval") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      if (arg === "--model") model = value;
      if (arg === "--binary") binary = value;
      if (arg === "--approval") approval = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) throw new Error(`Unknown flag ${arg}\n${usage()}`);
    prompt.push(arg);
  }
  return { model, binary, approval, prompt: prompt.join(" ").trim() || DEFAULT_PROMPT };
}

async function readTurn(session: CodexSession): Promise<string> {
  let text = "";
  for await (const event of session.events) {
    if (event.type === "text.delta") {
      text += event.delta;
      process.stdout.write(event.delta);
    } else if (event.type === "tool.started") {
      process.stderr.write(`\n[tool] ${event.title ?? event.tool}\n`);
    } else if (event.type === "approval.request") {
      process.stderr.write(`\n[approval] ${event.method} ${event.detail ?? ""}\n`);
    } else if (event.type === "error") {
      process.stderr.write(`\n[error] ${event.message}\n`);
    } else if (event.type === "turn.end") {
      process.stdout.write("\n");
      if (event.status !== "completed") throw new CodexHarnessError(`turn ended with ${event.status}`);
      return text;
    }
  }
  throw new CodexHarnessError("codex session closed before the turn ended");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const harness = createCodexHarness({ binaryPath: args.binary });
  const probe = await harness.probe();
  const summary = { installed: probe.installed, authed: probe.authed, models: probe.models };
  console.log(JSON.stringify(summary, null, 2));
  if (!probe.installed) {
    console.log("codex is not on PATH; smoke skipped. Install the Codex CLI and run `codex login`.");
    return;
  }
  if (probe.authed === false) {
    throw new CodexHarnessError("codex is installed but not authenticated. Run `codex login`. This script does not read ~/.codex.");
  }

  const session = await harness.open({
    cwd: process.cwd(),
    model: args.model,
    binaryPath: args.binary,
    approvalPolicy: args.approval ?? "never",
    sandboxPolicy: "workspace-write",
    autoApproval: "decline",
  });
  const timer = setTimeout(() => {
    console.error(`smoke timed out after ${TIMEOUT_MS}ms`);
    void session.close().finally(() => process.exit(1));
  }, TIMEOUT_MS);
  timer.unref();
  const stop = () => {
    void session.close().finally(() => process.exit(130));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const reading = readTurn(session);
  try {
    const { threadId } = await session.ensureThread();
    const { turnId } = await session.startTurn(args.prompt);
    console.error(`thread ${threadId} turn ${turnId}`);
    await reading;
  } finally {
    clearTimeout(timer);
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    await session.close();
    // Observe a reader that rejected because the session closed first.
    await reading.catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
