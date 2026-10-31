export interface SessionLimiter {
  readonly limit: number;
  readonly active: number;
  tryAcquire(): (() => void) | null;
}

/** A positive integer from 1 to 8. Anything else uses the fallback (default 2). */
export function readCodexSessionLimit(value: string | undefined, fallback = 2): number {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 8) return fallback;
  return parsed;
}

export function createSessionLimiter(limit: number): SessionLimiter {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("session limit must be a positive integer");
  let active = 0;
  return {
    limit,
    get active() {
      return active;
    },
    tryAcquire() {
      if (active >= limit) return null;
      active += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active -= 1;
      };
    },
  };
}

/**
 * One HTTP request's claim on a Codex slot.
 * The chat run calls `claim` before spawning. If the response ends first,
 * `releaseIfUnclaimed` frees the slot and `claim` returns false so Codex is not started.
 */
export interface SessionPermit {
  claim(): boolean;
  releaseIfUnclaimed(): void;
  finish(): void;
}

export function createSessionPermit(release: () => void): SessionPermit {
  let owner: "http" | "run" | "done" = "http";
  return {
    claim() {
      if (owner !== "http") return false;
      owner = "run";
      return true;
    },
    releaseIfUnclaimed() {
      if (owner !== "http") return;
      owner = "done";
      release();
    },
    finish() {
      if (owner === "done") return;
      owner = "done";
      release();
    },
  };
}

export function codexBusyResponse(): Response {
  return Response.json(
    { message: "Codex 正在处理的会话已达上限，请稍后再试" },
    { status: 429, headers: { "cache-control": "no-store", "retry-after": "2" } },
  );
}

/**
 * Call `release` when the body ends or is cancelled.
 * Codex passes `permit.releaseIfUnclaimed`, so a run that already claimed the slot keeps it until the process exits.
 */
export function holdSession(response: Response, release: () => void): Response {
  let released = false;
  const finish = () => {
    if (released) return;
    released = true;
    release();
  };
  const body = response.body;
  if (!body) {
    finish();
    return response;
  }
  const reader = body.getReader();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          finish();
          controller.close();
          return;
        }
        controller.enqueue(next.value);
      } catch (error) {
        finish();
        try {
          controller.error(error);
        } catch {
          /* The consumer may already have cancelled. */
        }
      }
    },
    cancel(reason) {
      finish();
      return reader.cancel(reason);
    },
  });
  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
