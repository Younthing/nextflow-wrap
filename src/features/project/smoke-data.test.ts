import { describe, expect, it } from "vitest";
import { smokeFastq } from "./smoke-data";

describe("smokeFastq", () => {
  it("produces deterministic valid reads and matching mate identifiers", () => {
    const first = smokeFastq(17, 1);
    expect(smokeFastq(17, 1)).toBe(first);
    const mates = [first, smokeFastq(17, 2)].map((text) => text.trim().split("\n"));
    expect(mates[0]).toHaveLength(200 * 4);
    for (let index = 0; index < mates[0].length; index += 4) {
      expect(mates[0][index].replace(/\/1$/, "")).toBe(mates[1][index].replace(/\/2$/, ""));
      expect(mates[0][index + 1]).toMatch(/^[ACGT]{100}$/);
      expect(mates[0][index + 2]).toBe("+");
      expect(mates[0][index + 3]).toHaveLength(mates[0][index + 1].length);
    }
  });
});
