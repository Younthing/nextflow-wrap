import { CodexHarnessError } from "./errors";
import { isRecord } from "./record";

/** Newline-delimited JSON-RPC without the `jsonrpc` header, matching Codex app-server. */
export interface LineTransport {
  writeLine(line: string): void;
  lines(): AsyncIterable<string>;
}

export interface JsonRpcNotification {
  method: string;
  params: unknown;
}

export interface JsonRpcServerRequest {
  id: string | number;
  method: string;
  params: unknown;
}

export interface JsonRpcHandlers {
  onNotification?: (message: JsonRpcNotification) => void;
  onServerRequest?: (message: JsonRpcServerRequest) => void;
  onProtocolError?: (message: string) => void;
  onUnexpectedClose?: (error: CodexHarnessError) => void;
}

interface PendingRequest {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface JsonRpcConnection {
  request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown>;
  notify(method: string, params?: unknown): void;
  respond(id: string | number, result: unknown): void;
  respondError(id: string | number, error: { code: number; message: string }): void;
  start(handlers: JsonRpcHandlers): void;
  close(): void;
}

export function createJsonRpc(transport: LineTransport): JsonRpcConnection {
  let nextId = 1;
  let started = false;
  let stopped = false;
  const pending = new Map<string | number, PendingRequest>();
  let handlers: JsonRpcHandlers = {};

  const rejectAll = (error: Error) => {
    for (const [id, request] of pending) {
      clearTimeout(request.timer);
      pending.delete(id);
      request.reject(error);
    }
  };

  const fail = (error: CodexHarnessError) => {
    if (stopped) return;
    stopped = true;
    rejectAll(error);
    handlers.onUnexpectedClose?.(error);
  };

  const send = (message: Record<string, unknown>) => {
    if (stopped) throw new CodexHarnessError("codex session is closed");
    transport.writeLine(JSON.stringify(message));
  };

  const settle = (id: string | number, message: Record<string, unknown>) => {
    const request = pending.get(id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(id);
    if ("error" in message && message.error !== undefined) {
      const body = message.error;
      const code = isRecord(body) && typeof body.code === "number" ? body.code : undefined;
      const text = isRecord(body) && typeof body.message === "string" ? body.message : "codex request failed";
      request.reject(new CodexHarnessError(`${request.method} failed: ${text}${code !== undefined ? ` (${code})` : ""}`));
      return;
    }
    request.resolve("result" in message ? message.result : undefined);
  };

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      handlers.onProtocolError?.("Received invalid JSON from codex app-server");
      return;
    }
    if (!isRecord(parsed)) {
      handlers.onProtocolError?.("codex sent a non-object JSON line");
      return;
    }
    const method = typeof parsed.method === "string" ? parsed.method : undefined;
    const hasId = "id" in parsed && parsed.id !== undefined && parsed.id !== null;
    const id = hasId && (typeof parsed.id === "string" || typeof parsed.id === "number") ? parsed.id : undefined;
    if (method && id !== undefined) {
      handlers.onServerRequest?.({ id, method, params: parsed.params });
      return;
    }
    if (method) {
      handlers.onNotification?.({ method, params: parsed.params });
      return;
    }
    if (id !== undefined) settle(id, parsed);
  };

  async function readLines(): Promise<void> {
    try {
      for await (const line of transport.lines()) handleLine(line);
      if (!stopped) fail(new CodexHarnessError("codex app-server closed stdout"));
    } catch (error) {
      if (!stopped) {
        const message = error instanceof Error ? error.message : "codex stdout failed";
        fail(new CodexHarnessError(message, { cause: error }));
      }
    }
  }

  return {
    request(method, params, timeoutMs = 30_000) {
      if (stopped) return Promise.reject(new CodexHarnessError("codex session is closed"));
      const id = nextId;
      nextId += 1;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new CodexHarnessError(`${method} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        timer.unref();
        pending.set(id, { method, resolve, reject, timer });
        try {
          send(params === undefined ? { method, id } : { method, id, params });
        } catch (error) {
          clearTimeout(timer);
          pending.delete(id);
          reject(error instanceof Error ? error : new CodexHarnessError(String(error)));
        }
      });
    },
    notify(method, params) {
      send(params === undefined ? { method } : { method, params });
    },
    respond(id, result) {
      send({ id, result });
    },
    respondError(id, error) {
      send({ id, error });
    },
    start(next) {
      if (started) return;
      started = true;
      handlers = next;
      void readLines();
    },
    close() {
      if (stopped) return;
      stopped = true;
      rejectAll(new CodexHarnessError("codex session closed"));
    },
  };
}
