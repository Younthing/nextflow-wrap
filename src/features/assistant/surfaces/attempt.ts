/** Runs a tool action and hands the model either its result or the error to fix, sync or async. */
export async function attempt<T>(fn: () => T | Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (err) {
    return { error: (err as Error).message };
  }
}
