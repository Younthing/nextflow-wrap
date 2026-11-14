"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { CopilotSidebar } from "@copilotkit/react-core/v2";
import { GripVertical, PanelRight, PanelsTopLeft, ExternalLink, X } from "lucide-react";

import { usePref } from "@/lib/local-pref";
import { toast } from "@/lib/toast";
import { AssistantChatInput, ChatError } from "./composer";
import { useCurrentProject } from "@/features/workspace/queries";
import { useConversationHistory } from "./conversation-history";
import { ConversationMenu } from "./conversation-menu";
import { AssistantToolRecords } from "./tool-record";
import { MessageQueueContext, useMessageQueue } from "./message-queue";

type Mode = "docked" | "floating" | "detached";
const clampWidth = (value: number) => Math.min(560, Math.max(320, value));
const HIDDEN_TOGGLE = { style: { display: "none" } };
const HeaderContext = React.createContext<React.ReactNode>(null);
const ConversationControls = React.createContext<React.ReactNode>(null);
function PanelHeader() {
  return React.useContext(HeaderContext);
}
// CopilotSidebar recreates its chat-view component when this slot changes.
// Keep its identity stable; only the header subscribes to the changing controls.
const HEADER_SLOT = { children: () => <PanelHeader /> };
const SIDEBAR_WIDTH = "100%";
const DEFAULT_PANEL_WIDTH = 440;
const MESSAGE_VIEW = { toolCallDisplay: "turn" } as const;

/** A stable portal host lets the chat move documents without remounting its tools or thread. */
export function AssistantPanel({ children, enabled = true, open, onOpenChange, labels, conversations = false }: {
  children: React.ReactNode;
  /** Off: only the workspace renders, so turning the assistant on later keeps the children mounted. */
  enabled?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  labels: React.ComponentProps<typeof CopilotSidebar>["labels"];
  conversations?: boolean;
}) {
  const [host, setHost] = React.useState<HTMLDivElement | null>(null);
  const [mode, setMode] = React.useState<Mode>("docked");
  const [storedWidth, saveWidth] = usePref<number>("nf-studio.assistant.width");
  const width = typeof storedWidth === "number" && Number.isFinite(storedWidth) ? clampWidth(storedWidth) : DEFAULT_PANEL_WIDTH;
  const [position, setPosition] = React.useState({ x: 80, y: 80 });
  const popup = React.useRef<Window | null>(null);
  const returnHost = React.useRef<() => void>(() => {});
  const drag = React.useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const resize = React.useRef<{ x: number; width: number } | null>(null);

  React.useEffect(() => {
    const element = document.createElement("div");
    element.className = "assistant-surface";
    document.body.appendChild(element);
    // The portal container is a browser resource created after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHost(element);
    return () => {
      returnHost.current = () => {};
      popup.current?.close();
      element.remove();
      document.body.removeAttribute("data-resizing");
    };
  }, []);

  const dock = React.useCallback(() => {
    if (host) document.body.appendChild(host);
    setMode("docked");
    const child = popup.current;
    popup.current = null;
    child?.close();
  }, [host]);

  React.useEffect(() => { returnHost.current = dock; }, [dock]);

  // A detached assistant follows live theme changes in the main window.
  React.useEffect(() => {
    const sync = () => {
      if (popup.current && !popup.current.closed) popup.current.document.documentElement.className = document.documentElement.className;
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    if (open) return;
    // Closing from the main navigation also returns an external window.
    const frame = requestAnimationFrame(() => { if (popup.current) dock(); });
    return () => cancelAnimationFrame(frame);
  }, [open, dock]);

  const detach = () => {
    if (!host) return;
    if (popup.current && !popup.current.closed) { popup.current.focus(); return; }
    const child = window.open("about:blank", "studio-assistant", `popup=yes,width=${width},height=760`);
    if (!child) { toast.error("未能打开独立窗口，请允许此站点弹出窗口"); return; }
    child.document.title = labels?.modalHeaderTitle ?? "AI 助手";
    child.document.documentElement.lang = "zh-CN";
    child.document.documentElement.className = document.documentElement.className;
    const base = child.document.createElement("base");
    base.href = document.baseURI;
    child.document.head.appendChild(base);
    document.querySelectorAll('style, link[rel="stylesheet"]').forEach((style) => child.document.head.appendChild(style.cloneNode(true)));
    child.document.body.className = "h-full overflow-hidden";
    child.document.documentElement.style.height = "100%";
    child.document.body.appendChild(host);
    popup.current = child;
    child.addEventListener("beforeunload", () => {
      if (popup.current === child) returnHost.current();
    }, { once: true });
    setMode("detached");
    child.focus();
  };

  React.useEffect(() => {
    if (!host) return;
    // Imperative updates target the external DOM container, not React state.
    // eslint-disable-next-line react-hooks/immutability
    host.dataset.mode = mode;
    host.dataset.open = String(open);
    host.style.setProperty("--assistant-width", `${width}px`);
    host.style.setProperty("--assistant-x", `${position.x}px`);
    host.style.setProperty("--assistant-y", `${position.y}px`);
  }, [host, mode, open, width, position]);

  const float = () => {
    setPosition({ x: Math.max(12, window.innerWidth - width - 32), y: 64 });
    setMode("floating");
  };
  const header = (
    <div className="assistant-panel-header"
      onDoubleClick={(event) => { if (!(event.target as HTMLElement).closest("button") && mode !== "detached") { if (mode === "docked") float(); else dock(); } }}
      onPointerDown={(event) => {
        if (mode === "detached" || event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
        const rect = host!.getBoundingClientRect();
        drag.current = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start || Math.abs(event.clientX - start.x) + Math.abs(event.clientY - start.y) < 6) return;
        setMode("floating");
        setPosition({ x: Math.max(0, Math.min(window.innerWidth - 80, start.left + event.clientX - start.x)), y: Math.max(0, Math.min(window.innerHeight - 52, start.top + event.clientY - start.y)) });
      }}
      onPointerUp={(event) => {
        if (!drag.current) return;
        const moved = Math.abs(event.clientX - drag.current.x) + Math.abs(event.clientY - drag.current.y) >= 6;
        drag.current = null;
        if (!moved) return;
        if (event.clientX < 0 || event.clientX > window.innerWidth || event.clientY < 0 || event.clientY > window.innerHeight) detach();
        else if (event.clientX > window.innerWidth - 40) dock();
      }}
      onLostPointerCapture={() => { drag.current = null; }}
    >
      <GripVertical className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <ConversationActions fallback={labels?.modalHeaderTitle} />
      {mode !== "docked" ? <HeaderAction label="停靠到右侧" onClick={dock}><PanelRight className="size-4" /></HeaderAction> : <HeaderAction label="在应用内浮动" onClick={float}><PanelsTopLeft className="size-4" /></HeaderAction>}
      {mode !== "detached" ? <HeaderAction label="移到独立窗口" onClick={detach}><ExternalLink className="size-4" /></HeaderAction> : null}
      <HeaderAction label="收起 AI 助手" onClick={() => { if (mode === "detached") dock(); onOpenChange(false); }}><X className="size-4" /></HeaderAction>
    </div>
  );

  return <>
    <div className="assistant-workspace" data-docked={open && mode === "docked"} style={{ "--assistant-width": `${width}px` } as React.CSSProperties}>{children}</div>
    {open && mode === "detached" ? <button type="button" onClick={dock} className="glass-strong fixed top-3 right-3 z-50 rounded-lg px-3 py-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">AI 已在独立窗口打开 · 移回此窗口</button> : null}
    {enabled && host ? createPortal(<>
      <AssistantToolRecords />
      <HeaderContext value={header}>
        {/* The host CSS owns the live width. Changing CopilotKit's width prop
            replaces the scroll view, just like changing its header slot. */}
        <AssistantChat open={open} onOpenChange={onOpenChange} labels={labels} conversations={conversations} />
      </HeaderContext>
      {mode !== "detached" ? <div role="separator" aria-label="调整 AI 面板宽度" aria-orientation="vertical" aria-valuemin={320} aria-valuemax={560} aria-valuenow={width} tabIndex={0} className="assistant-width-handle"
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); saveWidth(clampWidth(width + (event.key === "ArrowLeft" ? 16 : -16))); }
          if (event.key === "Home") saveWidth(DEFAULT_PANEL_WIDTH);
        }}
        onDoubleClick={() => saveWidth(DEFAULT_PANEL_WIDTH)}
        onPointerDown={(event) => { if (event.button !== 0) return; resize.current = { x: event.clientX, width }; event.currentTarget.setPointerCapture(event.pointerId); document.body.setAttribute("data-resizing", ""); }}
        onPointerMove={(event) => { if (resize.current) saveWidth(clampWidth(resize.current.width + (mode === "floating" ? event.clientX - resize.current.x : resize.current.x - event.clientX))); }}
        onPointerUp={() => { resize.current = null; document.body.removeAttribute("data-resizing"); }}
        onLostPointerCapture={() => { resize.current = null; document.body.removeAttribute("data-resizing"); }}
      /> : null}
    </>, host) : null}
  </>;
}

function ConversationActions({ fallback }: { fallback?: string }) {
  return React.useContext(ConversationControls)
    ?? <span className="min-w-0 flex-1 truncate text-sm font-medium">{fallback}</span>;
}

type ChatProps = Pick<React.ComponentProps<typeof CopilotSidebar>, "open" | "onOpenChange" | "labels">;

function SidebarChat(props: ChatProps) {
  const queue = useMessageQueue();
  const [error, setError] = React.useState<string>();
  const errorTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  React.useEffect(() => () => clearTimeout(errorTimer.current), []);
  return (
    <MessageQueueContext value={queue}>
    <ChatError value={error}>
      <CopilotSidebar {...props} header={HEADER_SLOT} toggleButton={HIDDEN_TOGGLE} input={AssistantChatInput}
        suggestionView={NO_SUGGESTION_VIEW}
        messageView={MESSAGE_VIEW} width={SIDEBAR_WIDTH} className="assistant-chat"
        onError={(event) => {
          if (!("error" in event)) return;
          queue.setPaused(true);
          setError(event.error.message || "请求失败，请重试");
          clearTimeout(errorTimer.current);
          errorTimer.current = setTimeout(() => setError(undefined), 12_000);
        }}
      />
    </ChatError>
    </MessageQueueContext>
  );
}

const NO_SUGGESTION_VIEW = { className: "hidden" };

function AssistantChat({ conversations, ...props }: ChatProps & { conversations: boolean }) {
  if (conversations) return <ProjectChat {...props} />;
  return <SidebarChat {...props} />;
}

function ProjectChat(props: ChatProps) {
  const { project, isPending } = useCurrentProject();
  if (isPending) return null;
  const scope = project?.id ?? "no-project";
  return <ConversationChat key={scope} scope={scope} {...props} />;
}

function ConversationChat({ scope, ...props }: ChatProps & { scope: string }) {
  const history = useConversationHistory(scope);
  return (
    <ConversationControls value={
      <>
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={history.title}>{history.title}</span>
        <ConversationMenu {...history} />
      </>
    }>
      <SidebarChat key={history.active} {...props} />
    </ConversationControls>
  );
}

function HeaderAction({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" className="assistant-header-action" aria-label={label} title={label} onClick={onClick}>{children}</button>;
}
