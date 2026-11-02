import { http, HttpResponse } from "msw";

import { defaultSettings, type SettingsUpdate, type SettingsView } from "@/features/settings/types";

let view: SettingsView = {
  settings: defaultSettings(),
  secrets: { ANTHROPIC_API_KEY: false, OPENAI_API_KEY: false, GOOGLE_API_KEY: false },
  secretStorage: "keychain",
  environmentOverrides: [],
  runnerRestartNeeded: false,
};

/** Demo settings live in memory for the page session. */
export const settingsHandlers = [
  http.get("/api/settings", () => HttpResponse.json(view)),
  http.put("/api/settings", async ({ request }) => {
    const update = (await request.json()) as SettingsUpdate;
    const secrets = { ...view.secrets };
    for (const [key, value] of Object.entries(update.secrets ?? {})) secrets[key as keyof typeof secrets] = value !== null && Boolean(value);
    view = { ...view, settings: update.settings, secrets, runnerRestartNeeded: JSON.stringify(view.settings.runtime) !== JSON.stringify(update.settings.runtime) };
    return HttpResponse.json(view);
  }),
];
