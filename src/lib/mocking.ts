/**
 * Demo mode uses MSW; dev:real / NEXT_PUBLIC_API_MOCKING=disabled uses the local API.
 */
export const API_MOCKING_ENABLED =
  process.env.NEXT_PUBLIC_API_MOCKING !== "disabled";

const DEMO_KEY = "nf-studio-demo";

/** A real build can still open the demo, for example before the first-run setup has installed Nextflow. */
export function demoModeRequested(): boolean {
  try { return typeof window !== "undefined" && window.localStorage.getItem(DEMO_KEY) === "1"; }
  catch { return false; }
}

export const mockingActive = () => API_MOCKING_ENABLED || demoModeRequested();

/** Switch a real build in or out of the demo; the page reloads so no request escapes the change. */
export function setDemoMode(on: boolean) {
  try {
    if (on) window.localStorage.setItem(DEMO_KEY, "1");
    else window.localStorage.removeItem(DEMO_KEY);
  } catch { /* Storage blocked: the demo stays as it was. */ }
  window.location.reload();
}

let started: Promise<void> | null = null;

export function startMocking(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }
  if (!mockingActive()) {
    started ??= ("serviceWorker" in navigator ? navigator.serviceWorker.getRegistrations().then(async (registrations) => {
      await Promise.all(registrations.filter((registration) => (registration.active ?? registration.waiting ?? registration.installing)?.scriptURL.endsWith("/mockServiceWorker.js")).map((registration) => registration.unregister()));
    }) : Promise.resolve());
    return started;
  }
  started ??= import("@/mocks/browser").then(({ worker }) =>
    worker
      .start({ onUnhandledFrame: "bypass", quiet: true })
      .then(() => undefined),
  );
  return started;
}
