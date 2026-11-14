"use client";

import * as React from "react";
import { createStore, useStore, type StoreApi } from "zustand";
import type { ConfirmView } from "./confirm";

export interface PendingConfirmation {
  id: string;
  view: ConfirmView;
  approve: () => void;
  decline: () => void;
}

type Pending = PendingConfirmation | null;
const emptyStore = createStore<Pending>(() => null);
const Confirmations = React.createContext<StoreApi<Pending> | null>(null);

export function PendingConfirmationProvider({ children }: { children: React.ReactNode }) {
  const [store] = React.useState(() => createStore<Pending>(() => null));
  return <Confirmations value={store}>{children}</Confirmations>;
}

export function useConfirmationStore() {
  return React.useContext(Confirmations);
}

export function usePendingConfirmation(toolCallId?: string) {
  const store = useConfirmationStore();
  return useStore(store ?? emptyStore, (value) => value?.id === toolCallId ? value : null);
}
