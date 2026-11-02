"use client";

import * as React from "react";

/**
 * A small per-browser preference (a collapsed group, the open tabs). Storage can be missing or full in a private
 * window, so reads fall back to `null` and failed writes are ignored.
 */
export function readPref<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: unknown) {
  try {
    if (value === null || value === undefined) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Keep working without persistence.
  }
}

/** `useState` backed by `readPref`/`writePref`. Starts at `null` on the server and the first client render. */
export function usePref<T>(key: string): [T | null, (value: T | null) => void] {
  const [value, setValue] = React.useState<T | null>(null);
  React.useEffect(() => {
    // Read after mount so server and client render the same markup.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValue(readPref<T>(key));
  }, [key]);
  const update = React.useCallback((next: T | null) => {
    setValue(next);
    writePref(key, next);
  }, [key]);
  return [value, update];
}
