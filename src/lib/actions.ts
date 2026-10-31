/**
 * Commands and chords, in the shape ComfyUI registers: a command
 * (`id`, `label`, `run`) plus a combo (`key`, `ctrl`, `alt`, `shift`).
 * `ctrl` matches Ctrl or ⌘, the same way ComfyUI's `KeyComboImpl.fromEvent` does.
 *
 * `useActionShortcuts` is the one window listener. Canvas commands register
 * here. Context menus (U3) should render `action.label` and the shortcut
 * from this registry instead of adding another keydown listener.
 */

export type KeyCombo = {
  /** `KeyboardEvent.key`, compared case-insensitively. */
  key: string;
  /** Ctrl on Windows/Linux, ⌘ on macOS. Either modifier satisfies it. */
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
};

export type KeyEvent = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
};

export type ShortcutGuard = {
  typing: boolean;
  dialogOpen: boolean;
  /** An open menu or select popup should keep arrows, Enter, and Escape. */
  menuOpen?: boolean;
};

export type Action = {
  id: string;
  label: string;
  /** Primary chord, or a primary plus alternates (ComfyUI redo is Ctrl+Y and Ctrl+Shift+Z). */
  shortcut?: KeyCombo | readonly KeyCombo[];
  /**
   * When false, menus disable the command and the chord does not run.
   * A matched chord is still consumed so the browser does not handle it.
   */
  enabled?: () => boolean;
  run: () => void;
  /**
   * ComfyUI lets Ctrl/⌘+S through text fields (it is not in
   * `RESERVED_BY_TEXT_INPUT`) and blocks Ctrl/⌘+Z and Ctrl/⌘+Y there.
   * This editor keeps that save exception. Other chords stay quiet while typing.
   */
  allowWhileTyping?: boolean;
  /**
   * ComfyUI ignores every chord while a modal is open. Save in this editor
   * already worked with a dialog up, so it is the one command that still does.
   */
  allowWhileDialog?: boolean;
};

export type ShortcutPlatform = "mac" | "other";

const MODIFIER_KEYS = new Set(["control", "meta", "alt", "shift"]);

/**
 * US (and similar) layouts report Shift+1 as "!". Chords are stored as the
 * unshifted digit so the label stays Shift+1 / ⇧1.
 */
const SHIFTED_DIGITS: Record<string, string> = {
  "!": "1",
  "@": "2",
  "#": "3",
  "$": "4",
  "%": "5",
  "^": "6",
  "&": "7",
  "*": "8",
  "(": "9",
  ")": "0",
};

export function comboFromEvent(event: KeyEvent): KeyCombo {
  const shift = Boolean(event.shiftKey);
  return {
    key: shift ? (SHIFTED_DIGITS[event.key] ?? event.key) : event.key,
    ctrl: Boolean(event.ctrlKey || event.metaKey),
    alt: Boolean(event.altKey),
    shift,
  };
}

function isComboList(shortcut: KeyCombo | readonly KeyCombo[]): shortcut is readonly KeyCombo[] {
  return Array.isArray(shortcut);
}

export function combosOf(action: { shortcut?: KeyCombo | readonly KeyCombo[] }): readonly KeyCombo[] {
  const shortcut = action.shortcut;
  if (!shortcut) return [];
  return isComboList(shortcut) ? shortcut : [shortcut];
}

/** The chord shown in tooltips and menus. Alternates still run, they just stay off the label. */
export function primaryCombo(shortcut: KeyCombo | readonly KeyCombo[]): KeyCombo {
  if (!isComboList(shortcut)) return shortcut;
  const combo = shortcut[0];
  if (!combo) throw new Error("Action shortcut is empty");
  return combo;
}

function sameCombo(expected: KeyCombo, actual: KeyCombo): boolean {
  return (
    expected.key.toLowerCase() === actual.key.toLowerCase() &&
    Boolean(expected.ctrl) === Boolean(actual.ctrl) &&
    Boolean(expected.alt) === Boolean(actual.alt) &&
    Boolean(expected.shift) === Boolean(actual.shift)
  );
}

function keyLabel(key: string): string {
  if (key.toLowerCase() === "escape") return "Esc";
  return key.length === 1 ? key.toUpperCase() : key;
}

/** Mac uses the menu glyphs (⌘, ⇧, ⌥). Other platforms keep the existing Ctrl+Shift+Z labels. */
export function formatShortcut(combo: KeyCombo, platform: ShortcutPlatform): string {
  const key = keyLabel(combo.key);
  if (platform === "mac") {
    return `${combo.alt ? "⌥" : ""}${combo.shift ? "⇧" : ""}${combo.ctrl ? "⌘" : ""}${key}`;
  }
  const parts: string[] = [];
  if (combo.ctrl) parts.push("Ctrl");
  if (combo.alt) parts.push("Alt");
  if (combo.shift) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

/** Both platform labels, for docs and the assistant prompt. A bare key is not repeated. */
export function shortcutHint(shortcut: KeyCombo | readonly KeyCombo[]): string {
  const combo = primaryCombo(shortcut);
  const other = formatShortcut(combo, "other");
  const mac = formatShortcut(combo, "mac");
  return other === mac ? other : `${other} / ${mac}`;
}

export function isActionEnabled(action: Action): boolean {
  return action.enabled ? action.enabled() : true;
}

function isBlocked(action: Action, guard: ShortcutGuard): boolean {
  // Menus capture keys outright, including save. Dialogs still allow save.
  if (guard.menuOpen) return true;
  if (guard.typing && !action.allowWhileTyping) return true;
  if (guard.dialogOpen && !action.allowWhileDialog) return true;
  return false;
}

/**
 * Runs the command for this key, if one is registered.
 * Returns true when the chord belongs to a command, including a disabled one,
 * so the caller can preventDefault. Typing and open dialogs return false
 * unless that command opts out (save). An open menu always returns false
 * so it can handle Escape and arrows.
 */
export function handleShortcutKey(actions: readonly Action[], event: KeyEvent, guard: ShortcutGuard): boolean {
  if (MODIFIER_KEYS.has(event.key.toLowerCase())) return false;
  const combo = comboFromEvent(event);
  const action = actions.find(
    (candidate) => !isBlocked(candidate, guard) && combosOf(candidate).some((shortcut) => sameCombo(shortcut, combo)),
  );
  if (!action) return false;
  if (isActionEnabled(action)) action.run();
  return true;
}

const OPEN_DIALOG = "[role='dialog'][data-state='open'], [role='alertdialog'][data-state='open']";
const OPEN_MENU = "[role='menu'][data-state='open'], [role='listbox'][data-state='open']";

/** Same fields the previous editor listener treated as typing. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  return Boolean((target as Element).closest("input, textarea, [contenteditable=true]"));
}

/** Radix dialogs expose this state. ComfyUI consults its dialog stack for the same decision. */
export function isDialogOpen(root: ParentNode | null = typeof document === "undefined" ? null : document): boolean {
  return Boolean(root?.querySelector(OPEN_DIALOG));
}

/**
 * Context menus and select popups. Both use Radix `data-state` and should
 * keep the key (U3 will open the canvas menu through the same primitive).
 */
export function isMenuOpen(root: ParentNode | null = typeof document === "undefined" ? null : document): boolean {
  return Boolean(root?.querySelector(OPEN_MENU));
}

export type ActionRegistry = {
  register: (action: Action) => () => void;
  registerAll: (actions: readonly Action[]) => () => void;
  get: (id: string) => Action | undefined;
  list: () => readonly Action[];
  subscribe: (listener: () => void) => () => void;
};

export function createActionRegistry(): ActionRegistry {
  const actions = new Map<string, Action>();
  const listeners = new Set<() => void>();
  let snapshot: readonly Action[] = Object.freeze([]);

  const emit = () => {
    snapshot = Object.freeze([...actions.values()]);
    for (const listener of listeners) listener();
  };

  const register = (action: Action) => {
    actions.set(action.id, action);
    emit();
    return () => {
      if (actions.get(action.id) === action) {
        actions.delete(action.id);
        emit();
      }
    };
  };

  return {
    register,
    registerAll: (batch) => {
      for (const action of batch) actions.set(action.id, action);
      emit();
      return () => {
        let changed = false;
        for (const action of batch) {
          if (actions.get(action.id) === action) {
            actions.delete(action.id);
            changed = true;
          }
        }
        if (changed) emit();
      };
    },
    get: (id) => actions.get(id),
    list: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const actionRegistry = createActionRegistry();
