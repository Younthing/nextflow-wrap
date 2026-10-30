/**
 * Demo mode uses MSW; dev:real / NEXT_PUBLIC_API_MOCKING=disabled uses the local API.
 */
export const API_MOCKING_ENABLED =
  process.env.NEXT_PUBLIC_API_MOCKING !== "disabled";

let started: Promise<void> | null = null;

export function startMocking(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }
  if (!API_MOCKING_ENABLED) {
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
