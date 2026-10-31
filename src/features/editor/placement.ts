import { MODULE_CARD_WIDTH } from "./clipboard";

/**
 * Where a single new node should sit so it does not cover an existing card.
 *
 * Module cards are `w-64` (see `MODULE_CARD_WIDTH`). Height follows the ports,
 * so both axes use that same card size: a spot is clear when the boxes are
 * at least `PLACEMENT_GAP` apart on either axis. An exact stack is the
 * extreme case. A card already one box away, beside or below, stays put.
 *
 * The search is a square spiral on a `PLACEMENT_STEP` grid: the cell to the
 * right comes first, then clockwise around the ring. The first free cell
 * wins, which makes the nudge deterministic. Paste and duplicate do not use
 * this helper; they keep the fixed `PASTE_GAP` stair-step so a copied group
 * stays rigid.
 */
export const PLACEMENT_CARD_WIDTH = MODULE_CARD_WIDTH;

/**
 * Same as the card width. Real cards are often shorter and sometimes taller;
 * separating by a full card on x still clears a tall module.
 */
export const PLACEMENT_CARD_HEIGHT = PLACEMENT_CARD_WIDTH;

/** Minimum space between the card boxes. */
export const PLACEMENT_GAP = 24;

/** Spiral grid. Small enough to tuck a partial overlap beside the card it hit. */
export const PLACEMENT_STEP = 40;

/** Rings walked before giving up and stepping one card further right. */
export const PLACEMENT_MAX_RING = 32;

/** Distance that clears the padded box on that axis. */
export const PLACEMENT_CLEAR_X = PLACEMENT_CARD_WIDTH + PLACEMENT_GAP;

export const PLACEMENT_CLEAR_Y = PLACEMENT_CARD_HEIGHT + PLACEMENT_GAP;

export type PlacementPoint = { x: number; y: number };

/** True when the padded card boxes intersect, including an exact stack. */
export function cardsOverlap(a: PlacementPoint, b: PlacementPoint): boolean {
  return Math.abs(a.x - b.x) < PLACEMENT_CLEAR_X && Math.abs(a.y - b.y) < PLACEMENT_CLEAR_Y;
}

/**
 * Clockwise rings starting at the right-hand cell. Ring 1 is
 * (1,0), (1,1), (0,1), (-1,1), (-1,0), (-1,-1), (0,-1), (1,-1).
 */
function* spiralCells(maxRing: number): Generator<PlacementPoint> {
  yield { x: 0, y: 0 };
  for (let ring = 1; ring <= maxRing; ring++) {
    yield { x: ring, y: 0 };
    for (let y = 1; y <= ring; y++) yield { x: ring, y };
    for (let x = ring - 1; x >= -ring; x--) yield { x, y: ring };
    for (let y = ring - 1; y >= -ring; y--) yield { x: -ring, y };
    for (let x = -ring + 1; x <= ring; x++) yield { x, y: -ring };
    for (let y = -ring + 1; y <= -1; y++) yield { x: ring, y };
  }
}

function isClear(candidate: PlacementPoint, existing: readonly PlacementPoint[]): boolean {
  return existing.every((node) => !cardsOverlap(candidate, node));
}

/**
 * Returns `requested` when it is clear. Otherwise the nearest free spiral
 * cell. If the whole neighborhood is taken, the result is one card to the
 * right of the rightmost node that shares the request's row.
 */
export function placeWithoutOverlap(
  requested: PlacementPoint,
  existing: readonly PlacementPoint[],
): PlacementPoint {
  for (const cell of spiralCells(PLACEMENT_MAX_RING)) {
    const candidate = {
      x: requested.x + cell.x * PLACEMENT_STEP,
      y: requested.y + cell.y * PLACEMENT_STEP,
    };
    if (isClear(candidate, existing)) return candidate;
  }

  let x = requested.x + PLACEMENT_CLEAR_X;
  for (const node of existing) {
    if (Math.abs(requested.y - node.y) < PLACEMENT_CLEAR_Y) {
      x = Math.max(x, node.x + PLACEMENT_CLEAR_X);
    }
  }
  return { x, y: requested.y };
}
