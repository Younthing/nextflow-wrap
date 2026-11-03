import { ASSISTANT_MODULES_PROP } from "./contract";
import { composeAssistantPrompt } from "./compose";
import { isRecord } from "@/lib/record";

const MAX_IDS = 32;
const MAX_ID_LENGTH = 64;

/**
 * Module ids from a CopilotKit run body. A missing or malformed field is an
 * empty selection: the host prompt runs alone, with no scenario tools.
 */
export function readAssistantModuleIds(body: unknown): readonly string[] {
  if (!isRecord(body)) return [];
  const forwarded = body.forwardedProps;
  if (!isRecord(forwarded)) return [];
  const value = forwarded[ASSISTANT_MODULES_PROP];
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (!id || id.length > MAX_ID_LENGTH || ids.includes(id)) continue;
    ids.push(id);
    if (ids.length >= MAX_IDS) break;
  }
  return ids;
}

/**
 * Reads module ids without consuming the body the Copilot handler still needs.
 * GET, HEAD, and non-JSON requests carry no module list, so they get the host prompt alone.
 */
export async function requestAssistantPrompt(request: Request): Promise<{ request: Request; prompt: string }> {
  if (request.method === "GET" || request.method === "HEAD") {
    return { request, prompt: composeAssistantPrompt([]) };
  }
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().includes("json")) {
    return { request, prompt: composeAssistantPrompt([]) };
  }
  const text = await request.text();
  const rebuilt = new Request(request, { body: text });
  let moduleIds: readonly string[] = [];
  if (text) {
    try {
      moduleIds = readAssistantModuleIds(JSON.parse(text) as unknown);
    } catch {
      moduleIds = [];
    }
  }
  return { request: rebuilt, prompt: composeAssistantPrompt(moduleIds) };
}
