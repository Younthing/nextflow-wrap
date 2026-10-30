/** Failure while speaking to a local `codex app-server`. */
export class CodexHarnessError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CodexHarnessError";
  }
}
