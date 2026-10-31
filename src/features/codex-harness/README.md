# Codex harness

Thin Node client for a local [Codex](https://github.com/openai/codex) CLI. Import it from server code or scripts; it spawns a process and is not a browser component. It speaks newline-delimited JSON-RPC on stdio (no `jsonrpc` header) and exposes a small session API. The shape follows the Codex path in t3code (`initialize`, `thread/start`, `turn/start`, streamed item notifications, approval server-requests) without vendoring that code.

Authentication stays in the user's existing `codex login` (`~/.codex`). This module never reads or writes `auth.json`, never copies tokens, and calls `account/read` with `refreshToken: false`. `probe()` returns only `installed`, a boolean `authed`, and model ids.

ACP, Grok, Claude, and Cursor providers are out of scope. Steering, fork, and rollback are not implemented.

## API

```ts
import { createCodexHarness } from "@/features/codex-harness";

const harness = createCodexHarness();
const status = await harness.probe(); // does not start a thread

const session = await harness.open({
  cwd: process.cwd(),
  model: "gpt-test", // optional; omit to use the CLI default
  approvalPolicy: "onRequest", // never | onRequest | unlessTrusted
  sandboxPolicy: "workspace-write", // read-only | workspace-write | danger-full-access
  autoApproval: "decline", // default. "manual" waits for respondToApproval
});

const { threadId } = await session.ensureThread();
const { turnId } = await session.startTurn("Summarize this repo.");
for await (const event of session.events) {
  // text.delta | tool.started | tool.delta | tool.completed
  // approval.request | turn.end | error
  if (event.type === "turn.end") break;
}
await session.close();
```

`startTurn` calls `ensureThread` when the thread does not exist yet. Command and file-change approvals are answered with `{ decision }`. The default `autoApproval: "decline"` replies immediately so a turn cannot wait forever. Pass `autoApproval: "manual"` and call `respondToApproval(requestId, "accept" | "decline" | ...)`.

`approvalPolicy` and `sandboxPolicy` are normalized to the current app-server tokens (`onRequest`, `unlessTrusted`, `readOnly`, `workspaceWrite`, `dangerFullAccess`). `on-request`, `untrusted`, and kebab-case sandbox names are accepted. Both the thread `sandbox` field and the turn `sandboxPolicy.type` use those camelCase tokens. Unknown strings are forwarded unchanged. Stream errors with `willRetry: true` are ignored; `turn/completed` is the end of the turn.

`probe()` checks `codex --version`, then opens a short-lived app-server only to read account status and, briefly, `model/list`. A slow model catalog cannot hide an auth result that already came back. It does not call `thread/start`.

## Smoke test against a real login

The unit tests use an in-memory stdio peer and do not need the CLI. To run one real turn on a machine where Codex is already logged in:

```bash
codex login   # once; tokens stay in ~/.codex
pnpm codex:smoke
pnpm codex:smoke -- Reply with the single word pong
pnpm codex:smoke --model gpt-test --approval never -- Say hello
```

`--binary` overrides the executable (the same value as `open({ binaryPath })`). The script skips with exit code 0 when `codex` is not on `PATH`. It exits 1 when the CLI is present but `account/read` says the user is not authenticated. Approvals during the smoke run are auto-declined. The sandbox is `workspace-write` and the approval policy defaults to `never`. The working directory is an empty temporary directory, not the repository, so the smoke turn cannot read or write the project. The default prompt does not need local files. On timeout, SIGINT, or SIGTERM after the session is open, the script closes that process before deleting the directory.

## Assistant

The CopilotKit route (`/api/copilotkit`) uses this harness when `COPILOT_BACKEND` is `auto` (the default) or `codex` and `probe()` reports an installed, authenticated CLI. That path does not read `OPENAI_API_KEY`. `auto` falls back to the API-key BuiltInAgent when Codex is missing or not logged in. Each chat run opens a short-lived read-only thread (`approvalPolicy: never`) with an empty temporary directory as its cwd, then closes the process and deletes that directory. The route accepts only allowlisted loopback hosts and same-origin browser requests. At most `CODEX_MAX_SESSIONS` Codex sessions run at once (default 2); another request gets HTTP 429.

A reply that is only `{"tool","arguments"}` for a known browser tool becomes one tool call. Any other reply is shown as text. An unknown tool name, or a tool JSON object with prose before or after it, fails the turn and does not run the tool. Prose-then-JSON is rejected rather than extracted: the prompt already requires a tool reply to be JSON alone, and executing a trailing object would hide the surrounding text. One user turn stops after 12 model replies, the same cap as the built-in agent's `maxSteps`.
