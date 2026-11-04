import type { CodexChild } from "@/features/codex-harness";
import { isRecord } from "@/lib/record";
import { GrokHarnessError } from "./errors";

/**
 * Newline-delimited JSON-RPC 2.0 over a stdio peer, as `grok agent stdio` speaks it.
 *
 * Unlike the Codex app-server, every frame carries `"jsonrpc": "2.0"`, and the
 * agent also sends requests to the client (`session/request_permission`,
 * `fs/*`, `terminal/*`). Unhandled agent requests get JSON-RPC
 * `-32601 Method not found` so the agent never waits on us.
 */
export interface AcpPeer {
  /** `timeoutMs` of 0 or undefined waits until the response or the process exits. */
  request(method: string, params: unknown, timeoutMs?: number): Promise<unknown>;
  notify(method: string, params: unknown): void;
  onNotification(handler: (method: string, params: unknown) => void): void;
  /** Return the JSON-RPC result. Throw a {@link GrokHarnessError} to reply with an error. */
  onRequest(handler: (method: string, params: unknown) => unknown): void;
  /** Resolves when stdout ends. Pending requests are rejected at that point. */
  readonly closed: Promise<void>;
}

interface Pending {
  method: string;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer?: ReturnType<typeof setTimeout>;
}

export const METHOD_NOT_FOUND = -32601;

export function createAcpPeer(child: CodexChild): AcpPeer {
  let nextId = 1;
  const pending = new Map<number, Pending>();
  const notificationHandlers: Array<(method: string, params: unknown) => void> = [];
  let requestHandler: ((method: string, params: unknown) => unknown) | undefined;
  let ended = false;

  function write(frame: Record<string, unknown>): void {
    child.writeLine(JSON.stringify({ jsonrpc: "2.0", ...frame }));
  }

  function failAll(reason: string): void {
    for (const [id, entry] of pending) {
      pending.delete(id);
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(new GrokHarnessError(`${entry.method}: ${reason}`));
    }
  }

  async function answer(id: unknown, method: string, params: unknown): Promise<void> {
    try {
      if (!requestHandler) throw new GrokHarnessError(`Method not found: ${method}`, { code: METHOD_NOT_FOUND });
      const result = await requestHandler(method, params);
      write({ id, result: result ?? null });
    } catch (error) {
      const code = error instanceof GrokHarnessError && error.code !== undefined ? error.code : -32603;
      const message = error instanceof Error ? error.message : String(error);
      try {
        write({ id, error: { code, message } });
      } catch {
        /* The process is gone. */
      }
    }
  }

  function dispatch(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let message: unknown;
    try {
      message = JSON.parse(trimmed);
    } catch {
      return; // Not a protocol frame. Logs go to stderr, but be lenient.
    }
    if (!isRecord(message)) return;
    const method = typeof message.method === "string" ? message.method : undefined;
    const hasId = message.id !== undefined && message.id !== null;
    if (method && hasId) {
      void answer(message.id, method, message.params);
      return;
    }
    if (method) {
      for (const handler of notificationHandlers) handler(method, message.params);
      return;
    }
    if (!hasId || typeof message.id !== "number") return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (entry.timer) clearTimeout(entry.timer);
    if (isRecord(message.error)) {
      const code = typeof message.error.code === "number" ? message.error.code : undefined;
      const text = typeof message.error.message === "string" ? message.error.message : "unknown error";
      entry.reject(new GrokHarnessError(`${entry.method}: ${text}`, { code }));
      return;
    }
    entry.resolve(message.result);
  }

  const closed = (async () => {
    try {
      for await (const line of child.lines()) dispatch(line);
    } finally {
      ended = true;
      const tail = child.stderrTail().trim().split("\n").slice(-3).join(" ").slice(0, 400);
      failAll(tail ? `grok agent exited (${tail})` : "grok agent exited");
    }
  })();

  return {
    request(method, params, timeoutMs) {
      if (ended) return Promise.reject(new GrokHarnessError(`${method}: grok agent exited`));
      const id = nextId++;
      return new Promise<unknown>((resolve, reject) => {
        const entry: Pending = { method, resolve, reject };
        if (timeoutMs && timeoutMs > 0) {
          entry.timer = setTimeout(() => {
            pending.delete(id);
            reject(new GrokHarnessError(`${method} timed out after ${timeoutMs}ms`));
          }, timeoutMs);
          entry.timer.unref?.();
        }
        pending.set(id, entry);
        try {
          write({ id, method, params });
        } catch (error) {
          pending.delete(id);
          if (entry.timer) clearTimeout(entry.timer);
          reject(error instanceof Error ? error : new GrokHarnessError(String(error)));
        }
      });
    },
    notify(method, params) {
      write({ method, params });
    },
    onNotification(handler) {
      notificationHandlers.push(handler);
    },
    onRequest(handler) {
      requestHandler = handler;
    },
    closed,
  };
}
