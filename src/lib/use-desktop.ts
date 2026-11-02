"use client";

import * as React from "react";

import { isDesktop } from "./desktop";

const noSubscribe = () => () => {};

/** True inside the Electron shell. False on the server and in a plain browser, so markup matches on hydration. */
export function useIsDesktop(): boolean {
  return React.useSyncExternalStore(noSubscribe, isDesktop, () => false);
}
