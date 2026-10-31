import { describe, expect, it } from "vitest";

import { allowedCopilotHosts, copilotAccessResponse, DEFAULT_COPILOT_HOSTS } from "./request-guard";

const hosts = { allowedHosts: DEFAULT_COPILOT_HOSTS };

function post(url: string, headers: Record<string, string>) {
  return new Request(url, { method: "POST", headers });
}

describe("copilot access checks", () => {
  it("rejects a cross-origin POST", async () => {
    const response = copilotAccessResponse(post("http://127.0.0.1:3000/api/copilotkit", {
      host: "127.0.0.1:3000",
      origin: "https://external.example",
      "sec-fetch-site": "cross-site",
    }), hosts);
    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toEqual({ message: "不允许跨站调用 AI 助手" });
  });

  it("rejects a different loopback port and a POST with no Origin", async () => {
    const otherPort = copilotAccessResponse(post("http://127.0.0.1:3000/api/copilotkit", {
      host: "127.0.0.1:3000",
      origin: "http://127.0.0.1:9999",
      "sec-fetch-site": "same-site",
    }), hosts);
    expect(otherPort?.status).toBe(403);

    const missing = copilotAccessResponse(post("http://127.0.0.1:3000/api/copilotkit", {
      host: "127.0.0.1:3000",
    }), hosts);
    expect(missing?.status).toBe(403);
  });

  it("rejects a non-loopback host even when the origin matches it", async () => {
    const response = copilotAccessResponse(post("http://studio.example:3000/api/copilotkit", {
      host: "studio.example:3000",
      origin: "http://studio.example:3000",
      "sec-fetch-site": "same-origin",
    }), hosts);
    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toEqual({ message: "AI 助手只接受本机回环地址" });
  });

  it("accepts a same-origin loopback POST when Next rewrites the request URL", () => {
    const response = copilotAccessResponse(post("http://localhost:3000/api/copilotkit", {
      host: "127.0.0.1:3000",
      origin: "http://127.0.0.1:3000",
      "sec-fetch-site": "same-origin",
    }), hosts);
    expect(response).toBeNull();
  });

  it("accepts IPv6 loopback and a normalized 127.1 host", () => {
    expect(copilotAccessResponse(post("http://[::1]:3000/api/copilotkit", {
      host: "[::1]:3000",
      origin: "http://[::1]:3000",
      "sec-fetch-site": "same-origin",
    }), hosts)).toBeNull();
    expect(copilotAccessResponse(post("http://127.0.0.1:3000/api/copilotkit", {
      host: "127.1:3000",
      origin: "http://127.0.0.1:3000",
      "sec-fetch-site": "same-origin",
    }), hosts)).toBeNull();
  });

  it("allows a loopback status GET without Origin and rejects a foreign one", async () => {
    const local = copilotAccessResponse(new Request("http://127.0.0.1:3000/api/copilotkit/status", {
      headers: { host: "127.0.0.1:3000" },
    }), hosts);
    expect(local).toBeNull();

    const foreign = copilotAccessResponse(new Request("http://127.0.0.1:3000/api/copilotkit/status", {
      headers: { host: "127.0.0.1:3000", origin: "https://external.example", "sec-fetch-site": "cross-site" },
    }), hosts);
    expect(foreign?.status).toBe(403);
  });

  it("reads an explicit host allowlist and keeps the loopback defaults", () => {
    expect(allowedCopilotHosts({})).toEqual(DEFAULT_COPILOT_HOSTS);
    expect(allowedCopilotHosts({ COPILOT_ALLOWED_HOSTS: "  " })).toEqual(DEFAULT_COPILOT_HOSTS);
    expect(allowedCopilotHosts({ COPILOT_ALLOWED_HOSTS: "studio.local, LOCALHOST" })).toEqual([
      "studio.local",
      "localhost",
    ]);
    const response = copilotAccessResponse(post("http://studio.local:3000/api/copilotkit", {
      host: "studio.local:3000",
      origin: "http://studio.local:3000",
      "sec-fetch-site": "same-origin",
    }), { allowedHosts: ["studio.local"] });
    expect(response).toBeNull();
  });
});
