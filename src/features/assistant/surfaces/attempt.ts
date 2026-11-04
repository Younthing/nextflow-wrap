/** Runs a tool action and hands the model either its result or the error to fix. */
export function attempt<T>(fn: () => T): Promise<T | { error: string }> {
  try {
    return Promise.resolve(fn());
  } catch (err) {
    return Promise.resolve({ error: (err as Error).message });
  }
}
