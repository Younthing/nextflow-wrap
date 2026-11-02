"use client";

import { create } from "zustand";

export interface Toast {
  id: number;
  tone: "info" | "success" | "warning" | "error";
  message: string;
}

interface ToastState {
  toasts: Toast[];
  push: (tone: Toast["tone"], message: string, sticky?: boolean) => number;
  update: (id: number, tone: Toast["tone"], message: string, sticky?: boolean) => void;
  dismiss: (id: number) => void;
}

const lifetime = (tone: Toast["tone"]) => (tone === "error" ? 6000 : 3500);

let seq = 0;

export const useToasts = create<ToastState>()((set, get) => ({
  toasts: [],
  push: (tone, message, sticky = false) => {
    const id = ++seq;
    set({ toasts: [...get().toasts, { id, tone, message }].slice(-4) });
    if (!sticky) setTimeout(() => get().dismiss(id), lifetime(tone));
    return id;
  },
  update: (id, tone, message, sticky = false) => {
    if (!get().toasts.some((t) => t.id === id)) set({ toasts: [...get().toasts, { id, tone, message }].slice(-4) });
    else set({ toasts: get().toasts.map((t) => (t.id === id ? { ...t, tone, message } : t)) });
    if (!sticky) setTimeout(() => get().dismiss(id), lifetime(tone));
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = {
  info: (m: string) => useToasts.getState().push("info", m),
  success: (m: string) => useToasts.getState().push("success", m),
  warning: (m: string) => useToasts.getState().push("warning", m),
  error: (m: string) => useToasts.getState().push("error", m),
  /** A toast that stays until finished, for long work such as an upload. */
  progress: (m: string) => {
    const id = useToasts.getState().push("info", m, true);
    return {
      update: (next: string) => useToasts.getState().update(id, "info", next, true),
      success: (next: string) => useToasts.getState().update(id, "success", next),
      error: (next: string) => useToasts.getState().update(id, "error", next),
    };
  },
};
