import { ASSISTANT_MODULES_PROP } from "./contract";
import { composeAssistantPrompt } from "./compose";

const MAX_IDS = 32;
const MAX_ID_LENGTH = 64;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return true;
}

/**
 * Module ids from a CopilotKit run body. `undefined` means the field was
 * absent or malformed, so the caller keeps the default modules. An array
 * is an explicit selection, even when every entry is ignored.
 */
export function readAssistantModuleIds(body: unknown): readonly string[] | undefined {
  if (!isRecord(body)) return undefined;
  const forwarded = body.forwardedProps;
  if (!isRecord(forwarded) || !Object.prototype.hasOwnProperty.call(forwarded, ASSISTANT_MODULES_PROP)) return undefined;
  const value = forwarded[ASSISTANT_MODULES_PROP];
  if (!Array.isArray(value)) return undefined;
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
 * Non-JSON requests keep the default prompt and the original request.
 */
export async function requestAssistantPrompt(request: Request): Promise<{ request: Request; prompt: string }> {
  if (request.method === "GET" || request.method === "HEAD") {
    return { request, prompt: composeAssistantPrompt() };
  }
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().includes("json")) {
    return { request, prompt: composeAssistantPrompt() };
  }
  const text = await request.text();
  const rebuilt = new Request(request, { body: text });
  let moduleIds: readonly string[] | undefined;
  if (text) {
    try {
      moduleIds = readAssistantModuleIds(JSON.parse(text) as unknown);
    } catch {
      moduleIds = undefined;
    }
  }
  return { request: rebuilt, prompt: composeAssistantPrompt(moduleIds) };
}
