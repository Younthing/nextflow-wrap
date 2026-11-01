import { saveSettings, settingsUpdateSchema, settingsView } from "@/lib/server/settings";
import type { SettingsUpdate } from "../types";

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });

/** `/api/settings`: runtime defaults, notification and assistant settings. API keys are write-only. */
export async function handleSettingsApi(method: string, request: Request): Promise<Response> {
  if (method === "GET") return json(settingsView());
  if (method === "PUT") return json(saveSettings(settingsUpdateSchema.parse(await request.json()) as SettingsUpdate));
  return json({ message: "接口不存在" }, 404);
}
