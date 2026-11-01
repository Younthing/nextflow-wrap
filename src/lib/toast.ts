"use client";

import { create } from "zustand";

export interface Toast {
  id: number;
  tone: "info" | "success" | "warning" | "error";
  message: string;
}

interface ToastState {
  toasts: Toast[];
  push: (tone: Toast["tone"], message: string) => void;
  dismiss: (id: number) => void;
}

let seq = 0;

export const useToasts = create<ToastState>()((set, get) => ({
  toasts: [],
  push: (tone, message) => {
    const id = ++seq;
    set({ toasts: [...get().toasts, { id, tone, message }].slice(-4) });
    setTimeout(() => get().dismiss(id), tone === "error" ? 6000 : 3500);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = {
  info: (m: string) => useToasts.getState().push("info", m),
  success: (m: string) => useToasts.getState().push("success", m),
  warning: (m: string) => useToasts.getState().push("warning", m),
  error: (m: string) => useToasts.getState().push("error", m),
};
