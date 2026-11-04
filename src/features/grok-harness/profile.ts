import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Agent profile for chat turns. Grok Build's default agent carries ~30 host
 * tools (shell, file edit, web, subagents, image gen...). The `tools:`
 * allowlist keeps only `todo_write` plus the always-on MCP meta-tools, which
 * have nothing to reach because the session opens with `mcpServers: []`.
 * Browser tools are described in the prompt text and answered as JSON, the
 * same contract the Codex path uses.
 */
export const CHAT_AGENT_PROFILE = [
  "---",
  "name: nextflow-wrap-chat",
  "description: Chat assistant for nextflow-wrap. Browser tools are described in the prompt; no host tools.",
  "tools: todo_write",
  "---",
  "You are the assistant embedded in the nextflow-wrap web app.",
  "You have no shell, file, or web tools. Do not try to run commands or read files.",
  "Follow the instructions in the user message exactly, including when it asks for a reply that is only a JSON object.",
  "",
].join("\n");

/** Writes the profile to a private temp directory (never the session cwd). */
export async function writeChatProfile(): Promise<{ path: string; remove: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "nextflow-grok-profile-"));
  const path = join(dir, "chat-agent.md");
  await writeFile(path, CHAT_AGENT_PROFILE, { mode: 0o600 });
  return { path, remove: () => rm(dir, { recursive: true, force: true }) };
}
