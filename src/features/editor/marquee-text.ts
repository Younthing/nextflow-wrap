import { isEditableTarget } from "@/lib/actions";

/**
 * On `<html>` while a canvas marquee gesture is in progress.
 * `globals.css` uses it to stop the browser highlighting chrome.
 */
export const MARQUEE_TEXT_CLASS = "nf-marquee";

/**
 * Sidebars, inspector, and toolbar. Non-editable text opts out of selection;
 * inputs and textareas opt back in. See `globals.css`.
 */
export const EDITOR_CHROME_CLASS = "nf-chrome";

type SelectionNode = {
  nodeType?: number;
  closest?: (selector: string) => unknown;
  parentElement?: { closest: (selector: string) => unknown } | null;
};

type TextSelection = {
  isCollapsed: boolean;
  anchorNode: SelectionNode | null;
  removeAllRanges: () => void;
};

export type MarqueeTextRoot = {
  documentElement: { classList: { add: (token: string) => void; remove: (token: string) => void } };
  getSelection?: () => TextSelection | null;
};

export type MarqueePointerDown = {
  button: number;
  shiftKey: boolean;
  target: EventTarget | null;
};

/**
 * React Flow's selection key is Shift (the default `selectionKeyCode`).
 * A primary Shift-press on the canvas starts the marquee. A press inside a
 * field does not: that drag is the user selecting the field's own text.
 */
export function isCanvasMarqueePointerDown(event: MarqueePointerDown): boolean {
  return event.button === 0 && event.shiftKey && !isEditableTarget(event.target);
}

function selectionAnchorElement(node: SelectionNode | null): SelectionNode | null {
  if (!node) return null;
  if (node.nodeType === 1 && typeof node.closest === "function") return node;
  return node.parentElement ?? null;
}

/**
 * True when a range is sitting on chrome (a sidebar, a label, the inspector)
 * rather than inside an input, textarea, or contenteditable widget.
 */
export function shouldClearMarqueeTextSelection(
  selection: { isCollapsed: boolean; anchorNode: SelectionNode | null } | null,
): boolean {
  if (!selection || selection.isCollapsed) return false;
  const element = selectionAnchorElement(selection.anchorNode);
  if (!element) return true;
  return !isEditableTarget(element as EventTarget);
}

/** Drops a chrome highlight. A range inside a focused field is left in place. */
export function clearMarqueeTextSelection(doc: { getSelection?: () => TextSelection | null }): boolean {
  const selection = doc.getSelection?.() ?? null;
  if (!selection || !shouldClearMarqueeTextSelection(selection)) return false;
  selection.removeAllRanges();
  return true;
}

/** Cancel `selectstart` only for the open marquee, and never for a field. */
export function shouldPreventMarqueeSelectStart(guarding: boolean, target: EventTarget | null): boolean {
  return guarding && !isEditableTarget(target);
}

/** Mark the document and drop any chrome highlight before the drag paints one. */
export function beginMarqueeTextGuard(doc: MarqueeTextRoot): void {
  doc.documentElement.classList.add(MARQUEE_TEXT_CLASS);
  clearMarqueeTextSelection(doc);
}

/**
 * Clear at the end of the gesture, then once more on the next frame.
 * The browser commits the native range after pointerup listeners return,
 * so the class stays up through that frame unless a new marquee has started.
 */
export function releaseMarqueeTextGuard(
  doc: MarqueeTextRoot,
  gestureActive: () => boolean,
  schedule: (callback: () => void) => void,
): void {
  clearMarqueeTextSelection(doc);
  schedule(() => {
    clearMarqueeTextSelection(doc);
    if (!gestureActive()) doc.documentElement.classList.remove(MARQUEE_TEXT_CLASS);
  });
}
