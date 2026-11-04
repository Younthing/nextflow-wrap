/** Failure while speaking to a local `grok agent stdio` (ACP) process. */
export class GrokHarnessError extends Error {
  /** JSON-RPC error code when the agent answered with an error. */
  readonly code?: number;

  constructor(message: string, options?: { cause?: unknown; code?: number }) {
    super(message, options);
    this.name = "GrokHarnessError";
    if (options?.code !== undefined) this.code = options.code;
  }
}
