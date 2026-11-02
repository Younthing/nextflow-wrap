"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";

import { dragPanel, nudgePanel, shownWidth } from "@/lib/panel-size";
import { cn } from "@/lib/utils";
import { PANELS, useLayoutStore, usePanel, type PanelId } from "./layout-store";

const STEP = 16;

/**
 * The gap to the right of a side panel, doubling as its resize edge: drag to resize, drag far enough in to
 * collapse, double-click for the default width, arrow keys to step, Enter to collapse or open. A panel that
 * hides completely leaves a small button on the edge to bring it back.
 */
export function ResizeHandle({ panel, className }: { panel: PanelId; className?: string }) {
  const spec = PANELS[panel];
  const state = usePanel(panel);
  const setPanel = useLayoutStore((store) => store.setPanel);
  const togglePanel = useLayoutStore((store) => store.togglePanel);
  const drag = React.useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const hidden = state.collapsed && spec.collapsedWidth === 0;

  const finish = () => {
    drag.current = null;
    setDragging(false);
    document.body.removeAttribute("data-resizing");
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`调整${spec.label}宽度`}
      aria-valuemin={spec.collapsedWidth}
      aria-valuemax={spec.max}
      aria-valuenow={shownWidth(spec, state)}
      tabIndex={0}
      title={`拖动调整宽度 · 双击恢复默认 · Enter ${state.collapsed ? "展开" : "收起"}`}
      data-dragging={dragging ? "" : undefined}
      className={cn("group/resize relative w-3 shrink-0 cursor-col-resize touch-none outline-none select-none", className)}
      onPointerDown={(event) => {
        if (event.button !== 0 || event.target !== event.currentTarget) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: shownWidth(spec, state) };
        setDragging(true);
        // Widths follow the pointer without the open/close transition, and the cursor stays put over other content.
        document.body.setAttribute("data-resizing", "");
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        const raw = current.startWidth + event.clientX - current.startX;
        const next = dragPanel(spec, useLayoutStore.getState().panels[panel], raw);
        const now = useLayoutStore.getState().panels[panel];
        if (next.width !== now.width || next.collapsed !== now.collapsed) setPanel(panel, next);
      }}
      onPointerUp={finish}
      onLostPointerCapture={finish}
      onDoubleClick={() => setPanel(panel, { width: spec.defaultWidth, collapsed: false })}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          setPanel(panel, nudgePanel(spec, state, event.key === "ArrowRight" ? STEP : -STEP));
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          togglePanel(panel);
        }
      }}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-3 left-1/2 w-0.5 -translate-x-1/2 rounded-full transition-colors",
          "group-hover/resize:bg-primary/40 group-focus-visible/resize:bg-primary group-data-[dragging]/resize:bg-primary",
        )}
      />
      {hidden ? (
        <button
          type="button"
          aria-label={`显示${spec.label}`}
          title={`显示${spec.label}`}
          className="glass-strong absolute top-1/2 left-0 grid h-10 w-3 -translate-y-1/2 cursor-pointer place-items-center rounded-r-md text-muted-foreground hover:w-4 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
          onClick={() => togglePanel(panel)}
        >
          <ChevronRight className="size-3" />
        </button>
      ) : null}
    </div>
  );
}
