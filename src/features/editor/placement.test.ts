import { describe, expect, it } from "vitest";

import {
  PLACEMENT_CLEAR_X,
  PLACEMENT_CLEAR_Y,
  PLACEMENT_STEP,
  cardsOverlap,
  placeWithoutOverlap,
} from "./placement";

describe("placeWithoutOverlap", () => {
  it("keeps a position that is empty or already clear of the padded card", () => {
    expect(placeWithoutOverlap({ x: 10, y: 20 }, [])).toEqual({ x: 10, y: 20 });
    const occupied = [{ x: 0, y: 0 }];
    expect(placeWithoutOverlap({ x: PLACEMENT_CLEAR_X, y: 0 }, occupied)).toEqual({
      x: PLACEMENT_CLEAR_X,
      y: 0,
    });
    expect(placeWithoutOverlap({ x: 0, y: PLACEMENT_CLEAR_Y }, occupied)).toEqual({
      x: 0,
      y: PLACEMENT_CLEAR_Y,
    });
    expect(cardsOverlap({ x: PLACEMENT_CLEAR_X - 1, y: 0 }, occupied[0]!)).toBe(true);
    expect(cardsOverlap({ x: PLACEMENT_CLEAR_X, y: 0 }, occupied[0]!)).toBe(false);
  });

  it("nudges an exact stack one card width plus the gap, straight to the right", () => {
    expect(PLACEMENT_CLEAR_X % PLACEMENT_STEP).toBe(0);
    const requested = { x: 12, y: 8 };
    expect(placeWithoutOverlap(requested, [requested])).toEqual({
      x: requested.x + PLACEMENT_CLEAR_X,
      y: requested.y,
    });
    expect(placeWithoutOverlap(requested, [{ ...requested }, { ...requested }])).toEqual({
      x: requested.x + PLACEMENT_CLEAR_X,
      y: requested.y,
    });
  });

  it("nudges a heavy overlap to the next free grid cell", () => {
    const occupied = [{ x: 0, y: 0 }];
    const requested = { x: 100, y: 20 };
    expect(cardsOverlap(requested, occupied[0]!)).toBe(true);
    const placed = placeWithoutOverlap(requested, occupied);
    expect(placed).toEqual({ x: 300, y: 20 });
    expect(cardsOverlap(placed, occupied[0]!)).toBe(false);
    expect(placeWithoutOverlap(requested, occupied)).toEqual(placed);
  });

  it("walks clockwise when the cell to the right is taken", () => {
    const requested = { x: 0, y: 0 };
    const occupied = [requested, { x: PLACEMENT_CLEAR_X, y: 0 }];
    const placed = placeWithoutOverlap(requested, occupied);
    expect(placed).toEqual({ x: PLACEMENT_CLEAR_X, y: PLACEMENT_CLEAR_Y });
    expect(cardsOverlap(placed, occupied[0]!)).toBe(false);
    expect(cardsOverlap(placed, occupied[1]!)).toBe(false);
  });
});
