import { describe, expect, it } from "vitest";

import { planMime } from "./mime";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const JPEG = "/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYwLjMxLjEwMgD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABMAAEBAAAAAAAAAAAAAAAAAAAABgEBAQAAAAAAAAAAAAAAAAAABgcQAQAAAAAAAAAAAAAAAAAAAAARAQAAAAAAAAAAAAAAAAAAAAD/wAARCAAIAAgDASIAAhEAAxEA/9oADAMBAAIRAxEAPwCLAFF/f//Z";
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>`;

describe("planMime", () => {
  it("prefers an HTML table over plain text and over a sibling image", () => {
    const plan = planMime({
      "text/plain": "plain-frame",
      "image/png": PNG,
      "text/html": "<table><tr><td>S1</td></tr></table>",
    });
    expect(plan.kind).toBe("html");
    if (plan.kind !== "html") return;
    expect(JSON.stringify(plan.nodes)).toContain("S1");
  });

  it("renders png, jpeg, and svg when they are the richest safe payload", () => {
    expect(planMime({ "image/png": PNG, "text/plain": "散点图" })).toMatchObject({
      kind: "image",
      mime: "image/png",
      alt: "散点图",
    });
    expect(planMime({ "image/jpeg": JPEG, "text/plain": "照片" })).toMatchObject({
      kind: "image",
      mime: "image/jpeg",
      alt: "照片",
    });
    expect(planMime({ "image/svg+xml": SVG, "image/png": PNG, "text/plain": "色块" })).toMatchObject({
      kind: "image",
      mime: "image/svg+xml",
      alt: "色块",
    });
  });

  it("falls through to plain text when rich payloads are unsafe or empty", () => {
    expect(planMime({
      "text/html": "<script>alert(1)</script>",
      "image/png": "not-an-image",
      "text/plain": "plain",
    })).toMatchObject({ kind: "text", text: "plain" });
    expect(planMime({
      "image/svg+xml": `<svg><script>alert(1)</script></svg>`,
      "text/plain": "svg text",
    })).toMatchObject({ kind: "text", text: "svg text" });
  });
});
