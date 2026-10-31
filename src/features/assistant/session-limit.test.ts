import { describe, expect, it } from "vitest";

import { codexBusyResponse, createSessionLimiter, createSessionPermit, holdSession, readCodexSessionLimit } from "./session-limit";

describe("Codex session limit", () => {
  it("defaults to two sessions and ignores limits outside 1–8", () => {
    expect(readCodexSessionLimit(undefined)).toBe(2);
    expect(readCodexSessionLimit(" 2 ")).toBe(2);
    expect(readCodexSessionLimit("8")).toBe(8);
    expect(readCodexSessionLimit("9")).toBe(2);
    expect(readCodexSessionLimit("0")).toBe(2);
    expect(readCodexSessionLimit("nope")).toBe(2);
  });

  it("refuses the third session until one finishes", () => {
    const limiter = createSessionLimiter(2);
    const first = limiter.tryAcquire();
    const second = limiter.tryAcquire();
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(limiter.tryAcquire()).toBeNull();
    expect(codexBusyResponse().status).toBe(429);
    expect(codexBusyResponse().headers.get("retry-after")).toBe("2");

    first?.();
    const third = limiter.tryAcquire();
    expect(third).not.toBeNull();
    expect(limiter.active).toBe(2);
    second?.();
    third?.();
    expect(limiter.active).toBe(0);
  });

  it("does not free two slots when release runs twice", () => {
    const limiter = createSessionLimiter(1);
    const release = limiter.tryAcquire();
    release?.();
    release?.();
    const again = limiter.tryAcquire();
    expect(again).not.toBeNull();
    expect(limiter.tryAcquire()).toBeNull();
    again?.();
  });

  it("holds the slot until the response body ends", async () => {
    const limiter = createSessionLimiter(1);
    const release = limiter.tryAcquire();
    expect(release).not.toBeNull();
    const held = holdSession(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("hi"));
        controller.close();
      },
    })), release!);
    expect(limiter.tryAcquire()).toBeNull();
    await expect(held.text()).resolves.toBe("hi");
    expect(limiter.active).toBe(0);
  });

  it("holds the slot until a stream is cancelled", async () => {
    const limiter = createSessionLimiter(1);
    const release = limiter.tryAcquire();
    const held = holdSession(new Response(new ReadableStream({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode("a"));
      },
    })), release!);
    const reader = held.body?.getReader();
    await reader?.read();
    expect(limiter.active).toBe(1);
    await reader?.cancel();
    expect(limiter.active).toBe(0);
  });

  it("lets the Codex run keep the slot after the HTTP response ends", () => {
    const limiter = createSessionLimiter(1);
    const release = limiter.tryAcquire();
    expect(release).not.toBeNull();
    const permit = createSessionPermit(release!);
    expect(permit.claim()).toBe(true);
    permit.releaseIfUnclaimed();
    expect(limiter.active).toBe(1);
    permit.finish();
    permit.finish();
    expect(limiter.active).toBe(0);
    expect(permit.claim()).toBe(false);
  });

  it("does not let a finished response start Codex", () => {
    const limiter = createSessionLimiter(1);
    const release = limiter.tryAcquire();
    const permit = createSessionPermit(release!);
    permit.releaseIfUnclaimed();
    expect(limiter.active).toBe(0);
    expect(permit.claim()).toBe(false);
    permit.finish();
    expect(limiter.active).toBe(0);
  });

  it("releases immediately when the response has no body", () => {
    const limiter = createSessionLimiter(1);
    const release = limiter.tryAcquire();
    const held = holdSession(new Response(null, { status: 204 }), release!);
    expect(held.status).toBe(204);
    expect(limiter.active).toBe(0);
  });
});
