import { describe, expect, it } from "vitest";

import { stopSmokeSession } from "../../../scripts/codex-smoke";

describe("stopSmokeSession", () => {
  it("closes the Codex session before deleting its working directory", async () => {
    const order: string[] = [];
    await stopSmokeSession(
      { close: async () => { order.push("close"); } },
      async () => { order.push("remove"); },
    );
    expect(order).toEqual(["close", "remove"]);
  });

  it("still deletes the directory when no session was opened", async () => {
    const order: string[] = [];
    await stopSmokeSession(undefined, async () => { order.push("remove"); });
    expect(order).toEqual(["remove"]);
  });
});
