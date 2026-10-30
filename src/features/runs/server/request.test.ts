import { describe, expect, it } from "vitest";
import { assertSameOrigin } from "./service";

describe("local API origin validation", () => {
  it("accepts the actual browser host when Next.js normalizes its internal URL", () => {
    const request = new Request("http://localhost:3000/api/runs", { method: "POST", headers: { origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000", "sec-fetch-site": "same-origin" } });
    expect(() => assertSameOrigin(request)).not.toThrow();
  });
  it("rejects cross-site forms and forged origins", () => {
    const cases: Record<string, string>[] = [{ origin: "https://external.example", host: "127.0.0.1:3000" }, { "sec-fetch-site": "cross-site", host: "127.0.0.1:3000" }];
    for (const headers of cases) {
      expect(() => assertSameOrigin(new Request("http://localhost:3000/api/runs", { method: "POST", headers }))).toThrow("不允许跨站");
    }
  });
});
