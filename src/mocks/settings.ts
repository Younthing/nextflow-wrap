import { http, HttpResponse } from "msw";

import { defaultSettings, SECRET_KEYS, type SettingsUpdate, type SettingsView } from "@/features/settings/types";
import { DEMO_REMOTE_HOST } from "./remotes";

let view: SettingsView = {
  settings: { ...defaultSettings(), remotes: [DEMO_REMOTE_HOST] },
  secrets: Object.fromEntries(SECRET_KEYS.map((key) => [key, false])) as SettingsView["secrets"],
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
