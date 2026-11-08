"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { tabsPrefKey } from "./tabs";

const event = "studio-tabs-change";
const subscribe = (listener: () => void) => { window.addEventListener(event, listener); return () => window.removeEventListener(event, listener); };
const emptySubscribe = () => () => {};

/** Tab order belongs to this window and is restored only after hydration. */
export function useWindowTabs(project: string): [string[], (tabs: string[]) => void, boolean] {
  const key = tabsPrefKey(project);
  const ready = useSyncExternalStore(emptySubscribe, () => true, () => false);
  const raw = useSyncExternalStore(subscribe, () => {
    try { return window.sessionStorage.getItem(key) ?? "[]"; } catch { return "[]"; }
  }, () => "[]");
  const tabs = useMemo(() => {
    try { const value = JSON.parse(raw); return Array.isArray(value) ? value.filter((tab): tab is string => typeof tab === "string") : []; } catch { return []; }
  }, [raw]);
  const update = useCallback((next: string[]) => {
    window.sessionStorage.setItem(key, JSON.stringify(next));
    window.dispatchEvent(new Event(event));
  }, [key]);
  return [tabs, update, ready];
}
