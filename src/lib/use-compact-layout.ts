"use client";

import * as React from "react";

/** Observe the available space, including changes from neighboring resizable panels. */
export function useCompactLayout(minWidth: number, initiallyCompact = true) {
  const [compact, setCompact] = React.useState(initiallyCompact);
  const ref = React.useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    const measure = () => setCompact(element.clientWidth < minWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [minWidth]);

  return { ref, compact };
}
