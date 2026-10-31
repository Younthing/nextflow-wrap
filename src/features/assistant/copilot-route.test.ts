import { describe, expect, it } from "vitest";

import { HEAD, POST } from "./copilot-route";

describe("POST /api/copilotkit", () => {
  it("rejects a cross-origin POST before starting a model", async () => {
    const response = await POST(new Request("http://localhost:3000/api/copilotkit", {
      method: "POST",
      headers: {
        host: "127.0.0.1:3000",
        origin: "https://external.example",
        "sec-fetch-site": "cross-site",
      },
    }));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ message: "不允许跨站调用 AI 助手" });
  });
});

describe("HEAD /api/copilotkit", () => {
  it("does not start a model run", async () => {
    const response = await HEAD(new Request("http://127.0.0.1:3000/api/copilotkit", {
      method: "HEAD",
      headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin" },
    }));
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, POST, DELETE");
  });

  it("rejects a cross-origin HEAD", async () => {
    const response = await HEAD(new Request("http://127.0.0.1:3000/api/copilotkit", {
      method: "HEAD",
      headers: { host: "127.0.0.1:3000", origin: "https://external.example", "sec-fetch-site": "cross-site" },
    }));
    expect(response.status).toBe(403);
  });
});
