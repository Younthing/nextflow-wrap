/**
 * There is no backend yet, so mocking is on unless explicitly disabled with
 * NEXT_PUBLIC_API_MOCKING=disabled (e.g. once a real `/api` is deployed).
 */
export const API_MOCKING_ENABLED =
  process.env.NEXT_PUBLIC_API_MOCKING !== "disabled";

let started: Promise<void> | null = null;

export function startMocking(): Promise<void> {
  if (!API_MOCKING_ENABLED || typeof window === "undefined") {
    return Promise.resolve();
  }
  started ??= import("@/mocks/browser").then(({ worker }) =>
    worker
      .start({ onUnhandledFrame: "bypass", quiet: true })
      .then(() => undefined),
  );
  return started;
}
