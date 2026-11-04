# Grok Build harness

Thin Node client for a local [Grok Build](https://x.ai) CLI over ACP (`grok agent stdio`). Server code and scripts only. It lets the assistant use the subscription the user already signed into with `grok login`, symmetric to [`../codex-harness`](../codex-harness/README.md) for `codex login`. OpenBot/T3 are not used as a host; this is a direct ACP client.

Authentication stays in `~/.grok`. This module never reads `auth.json`, never copies tokens, and never passes credentials on the command line. Grok itself resolves auth (signed-in session token, then `XAI_API_KEY`).

## Protocol

Newline-delimited JSON-RPC 2.0 on stdio. Unlike the Codex app-server, every frame carries `"jsonrpc": "2.0"`, and the agent also sends requests to the client. `acp.ts` is a separate peer for that reason; the Codex parser is not reused.

1. `initialize` `{ protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } }`
2. `session/new` `{ cwd, mcpServers: [] }` → `{ sessionId }` (or `-32000 Authentication required`)
3. `session/prompt` `{ sessionId, prompt: [{ type: "text", text }] }` → `{ stopReason }` when the turn ends
4. `session/update` notifications stream the turn. `agent_message_chunk` becomes `text.delta`; `tool_call` / `tool_call_update` become `tool.started` / `tool.completed`; thoughts, plans and command lists are dropped.
5. `session/request_permission` (agent → client) is answered with the agent's `reject_once` option. Any other agent request (`fs/*`, `terminal/*`) gets `-32601`.
6. `session/cancel` (notification) interrupts; the prompt then returns `stopReason: "cancelled"` → `turn.end` status `interrupted`.

`stopReason: "end_turn"` maps to `turn.end` status `completed`, so the assistant turn layer consumes Grok events exactly like Codex events.

## Security posture for chat turns

Codex chat runs use an empty temp cwd, `approvalPolicy: never`, a read-only sandbox, and declined approvals. Grok runs match that and add more, because Grok Build's default agent auto-runs read-only tools (including `ls`/`cat`-style shell commands) even without always-approve:

| Layer | Setting |
| --- | --- |
| cwd | Empty temp directory per run, deleted afterwards. The repo is never the cwd. |
| Tools | `--agent-profile` with `tools: todo_write`. Grok's ~30 host tools (shell, read/write/edit, grep, web, subagents, image gen, scheduler) are removed. Only `todo_write` plus the MCP meta-tools remain, and those reach nothing because `mcpServers` is empty. |
| Approvals | No `--always-approve` / `yoloMode`. Permission prompts are rejected. |
| Sandbox | `GROK_SANDBOX=strict` (override with `GROK_CHAT_SANDBOX`). Reads limited to the cwd, system paths and `~/.grok`; writes to the cwd and temp; child network blocked on Linux. Verified: `ls`/`read_file` on the repo return `Permission denied` under this profile even with the default toolset. |
| Leader | `--no-leader`, so tools stay in-process and the sandbox applies. |
| Client caps | `fs` and `terminal` capabilities are off, so the agent cannot ask this process to touch files. |

Browser tools (canvas, runs, notebook) are not ACP tools. They are described in the prompt text and a reply that is only `{"tool","arguments"}` becomes an AG-UI tool call, the same bridge as Codex (`assistant/codex-turn.ts`).

## API

```ts
import { createGrokHarness } from "@/features/grok-harness";

const harness = createGrokHarness({ binaryPath: process.env.GROK_BIN });
await harness.probe(); // { installed, authed?, models? }; opens and closes a session, never prompts

const session = await harness.open({ cwd: emptyTempDir, model: "grok-4.7" });
const reading = (async () => {
  for await (const event of session.events) {
    // text.delta | tool.started | tool.completed | approval.request | turn.end | error
    if (event.type === "turn.end") break;
  }
})();
await session.startTurn("Reply with the single word pong.");
await reading;
await session.close(); // kills the process group and deletes the temp agent profile
```

## Assistant

`COPILOT_BACKEND=grok` forces this harness. `auto` uses it when Codex is not installed or not logged in and `probe()` reports `authed: true`. `GROK_MODEL` picks the model (`grok agent --model`); otherwise the CLI default. At most `GROK_MAX_SESSIONS` Grok sessions run at once (default 2, 1–8); another request gets HTTP 429 naming Grok.

## Smoke test against a real login

```bash
grok login
pnpm grok:smoke
pnpm grok:smoke --model grok-4.7-build-fast -- Say hello
pnpm grok:smoke --skip-bridge
```

Step 1 opens the harness in an empty temp directory and requires streamed text. Step 2 runs the assistant layer (`runGrokAssistant`) with one fake browser tool, `get_notebook_summary`, and requires an AG-UI `TOOL_CALL_START` for it. The script skips with exit 0 when `grok` is not on `PATH`, and exits 1 when `session/new` says the user is not authenticated.
