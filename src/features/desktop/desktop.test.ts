import { describe, expect, it } from "vitest";
import { allowedHost, checkSession } from "./session-guard";
import { parseEnvBlock, quitPrompt, RestartTracker } from "./supervisor";
import { projectMenuState, readProjectMenuState, RECENT_LIMIT } from "./project-menu";

describe("checkSession", () => {
  const base = { token: "secret-token", host: "127.0.0.1:51234", cookie: "secret-token", header: null, port: "51234" };
  it("lets everything through when no desktop token is configured", () => {
    expect(checkSession({ ...base, token: undefined, host: "evil.example" })).toEqual({ ok: true });
  });
  it("needs the loopback host on the app's port and the matching token", () => {
    expect(checkSession(base)).toEqual({ ok: true });
    expect(checkSession({ ...base, cookie: undefined, header: "secret-token" })).toEqual({ ok: true });
    expect(checkSession({ ...base, host: "attacker.test:51234" })).toMatchObject({ ok: false, status: 421 });
    expect(checkSession({ ...base, host: "127.0.0.1:3000" })).toMatchObject({ ok: false, status: 421 });
    expect(checkSession({ ...base, cookie: "secret-tokeX" })).toMatchObject({ ok: false, status: 403 });
    expect(checkSession({ ...base, cookie: undefined })).toMatchObject({ ok: false, status: 403 });
  });
  it("accepts localhost and ::1", () => {
    expect(allowedHost("localhost:9", "9")).toBe(true);
    expect(allowedHost("[::1]:9", "9")).toBe(true);
    expect(allowedHost("127.0.0.1.nip.io:9", "9")).toBe(false);
  });
});

describe("RestartTracker", () => {
  it("backs off and gives up after too many crashes in the window", () => {
    const tracker = new RestartTracker({ baseDelayMs: 100, maxDelayMs: 1000, maxCrashes: 3, windowMs: 10_000 });
    expect([0, 1, 2].map((t) => tracker.crash(t))).toEqual([100, 200, 400]);
    expect(tracker.crash(3)).toBeUndefined();
    expect(tracker.crash(20_000)).toBe(100);
    tracker.healthy();
    expect(tracker.crash(20_001)).toBe(100);
  });
});

describe("desktop helpers", () => {
  it("asks before quitting only when runs are active", () => {
    expect(quitPrompt(0).needed).toBe(false);
    expect(quitPrompt(2)).toMatchObject({ needed: true, message: "还有 2 个运行没有结束" });
  });
  it("parses a NUL separated environment", () => {
    expect(parseEnvBlock("PATH=/opt/homebrew/bin:/usr/bin\0EMPTY=\0X=a=b\0")).toEqual({ PATH: "/opt/homebrew/bin:/usr/bin", EMPTY: "", X: "a=b" });
  });
});

describe("project menu", () => {
  const project = (id: string, openedAt: string) => ({ id, name: `项目 ${id}`, path: `/data/${id}`, createdAt: openedAt, openedAt });

  it("lists the open project and the most recently opened first", () => {
    const state = projectMenuState({
      current: "b",
      projects: [project("a", "2026-01-01"), project("b", "2026-03-01"), project("c", "2026-02-01")],
    });
    expect(state.current).toEqual({ id: "b", name: "项目 b", path: "/data/b" });
    expect(state.recent.map((item) => item.id)).toEqual(["b", "c", "a"]);
  });

  it("caps the recent list", () => {
    const projects = Array.from({ length: RECENT_LIMIT + 3 }, (_, i) => project(`p${i}`, `2026-01-${String(i + 1).padStart(2, "0")}`));
    expect(projectMenuState({ projects }).recent).toHaveLength(RECENT_LIMIT);
  });

  it("drops malformed entries sent to the main process", () => {
    expect(readProjectMenuState("nope")).toEqual({ recent: [] });
    expect(readProjectMenuState({
      current: { id: "a", name: "A" },
      recent: [{ id: "b", name: "B", path: "/b", extra: true }, { id: 1 }],
    })).toEqual({ current: undefined, recent: [{ id: "b", name: "B", path: "/b" }] });
  });
});
