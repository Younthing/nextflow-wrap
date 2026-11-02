/** Size rules for a side panel the user can drag wider, narrower, or shut. */
export interface PanelSpec {
  min: number;
  max: number;
  defaultWidth: number;
  /** Width the panel shows while collapsed: an icon rail, or 0 when it hides completely. */
  collapsedWidth: number;
  /** Dragging the edge narrower than this collapses the panel; dragging a collapsed one past it opens it. */
  collapseBelow: number;
}

export interface PanelState {
  /** Width when open. Kept while collapsed so reopening restores it. */
  width: number;
  collapsed: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** The width the panel takes on screen. */
export function shownWidth(spec: PanelSpec, state: PanelState): number {
  return state.collapsed ? spec.collapsedWidth : clamp(state.width, spec.min, spec.max);
}

/** Where a drag of the panel's edge to `raw` pixels leaves it. */
export function dragPanel(spec: PanelSpec, state: PanelState, raw: number): PanelState {
  if (raw < spec.collapseBelow) return { width: state.width, collapsed: true };
  return { width: clamp(Math.round(raw), spec.min, spec.max), collapsed: false };
}

/** Arrow keys on the edge: step the width, opening a collapsed panel but never shutting one. */
export function nudgePanel(spec: PanelSpec, state: PanelState, delta: number): PanelState {
  if (state.collapsed) return delta > 0 ? { width: state.width, collapsed: false } : state;
  return { width: clamp(state.width + delta, spec.min, spec.max), collapsed: false };
}

/** Stored state can be from an older build or edited by hand; fall back to the default for anything odd. */
export function readPanelState(spec: PanelSpec, value: unknown): PanelState {
  const fallback = { width: spec.defaultWidth, collapsed: false };
  if (!value || typeof value !== "object") return fallback;
  const { width, collapsed } = value as Partial<PanelState>;
  return {
    width: typeof width === "number" && Number.isFinite(width) ? clamp(width, spec.min, spec.max) : spec.defaultWidth,
    collapsed: collapsed === true,
  };
}
