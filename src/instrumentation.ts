/** Runs once when the Next.js server starts: settings saved on the settings page become environment variables. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { applyStoredSettings } = await import("@/lib/server/settings");
  applyStoredSettings();
}
