"use client";

import * as React from "react";
import { create } from "zustand";

import { readPref, writePref } from "@/lib/local-pref";
import { readPanelState, type PanelSpec, type PanelState } from "@/lib/panel-size";

export type PanelId = "nav" | "explorer";

export const PANELS: Record<PanelId, PanelSpec & { label: string }> = {
  /** Main navigation: collapses to an icon rail so pages stay one click away. */
  nav: { label: "导航栏", min: 168, max: 288, defaultWidth: 192, collapsedWidth: 56, collapseBelow: 120 },
  /** Workbench notebooks, files and runtimes: hides completely. */
  explorer: { label: "资源栏", min: 200, max: 520, defaultWidth: 248, collapsedWidth: 0, collapseBelow: 140 },
};

const prefKey = (id: PanelId) => `nf-studio.layout.${id}`;

interface LayoutState {
  panels: Record<PanelId, PanelState>;
  /** Stored sizes are read after mount, so server and first client render agree. */
  hydrated: boolean;
  hydrate: () => void;
  setPanel: (id: PanelId, state: PanelState) => void;
  togglePanel: (id: PanelId) => void;
}

const defaults = (): Record<PanelId, PanelState> => ({
  nav: readPanelState(PANELS.nav, null),
  explorer: readPanelState(PANELS.explorer, null),
});

export const useLayoutStore = create<LayoutState>()((set, get) => ({
  panels: defaults(),
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    set({
      hydrated: true,
      panels: {
        nav: readPanelState(PANELS.nav, readPref(prefKey("nav"))),
        explorer: readPanelState(PANELS.explorer, readPref(prefKey("explorer"))),
      },
    });
  },
  setPanel: (id, state) => {
    writePref(prefKey(id), state);
    set({ panels: { ...get().panels, [id]: state } });
  },
  togglePanel: (id) => {
    const current = get().panels[id];
    get().setPanel(id, { ...current, collapsed: !current.collapsed });
  },
}));

export const usePanel = (id: PanelId) => useLayoutStore((state) => state.panels[id]);

/**
 * Reads stored panel sizes once, then lets width changes animate. The first paint uses the stored widths with no
 * transition, so the layout does not slide into place on every load.
 */
export function useHydrateLayout() {
  React.useEffect(() => {
    useLayoutStore.getState().hydrate();
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => document.body.setAttribute("data-layout-ready", ""));
    });
    return () => cancelAnimationFrame(frame);
  }, []);
}
