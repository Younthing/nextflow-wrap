"use client";

import * as React from "react";
import { CopilotKitProvider, CopilotSidebar } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";

const RUNTIME_URL = "/api/copilotkit";

const LABELS = {
  modalHeaderTitle: "AI 助手",
  welcomeMessageText: "我可以帮你搭流程、调参数，或者解释一次运行为什么失败。",
  chatInputPlaceholder: "描述你想做的事…",
  chatDisclaimerText: "AI 可能出错，运行前请检查流程。所有画布改动都能撤销。",
  chatToggleOpenLabel: "打开 AI 助手",
  chatToggleCloseLabel: "关闭 AI 助手",
  chatInputToolbarSendButtonLabel: "发送",
  chatInputToolbarStopButtonLabel: "停止",
  modalHeaderCloseButtonLabel: "关闭",
  reasoningMessageThinkingLabel: "思考中…",
  sidebarLabel: "AI 助手侧边栏",
};

export type AssistantStatus = { enabled: true; detail: string } | { enabled: false; message: string };

interface AssistantContextValue {
  status: AssistantStatus;
  open: boolean;
  setOpen: (open: boolean) => void;
}

const AssistantContext = React.createContext<AssistantContextValue>({
  status: { enabled: false, message: "" },
  open: false,
  setOpen: () => {},
});

/** Whether the server has a model configured; tool bridges render only then. */
export const useAssistantStatus = () => React.useContext(AssistantContext).status;
export const useAssistantPanel = () => React.useContext(AssistantContext);

/** The sidebar opens from the header button, not CopilotKit's floating one. */
const HIDDEN_TOGGLE = { style: { display: "none" } };

async function fetchStatus(): Promise<AssistantStatus> {
  try {
    const res = await fetch(`${RUNTIME_URL}/status`);
    if (!res.ok) return { enabled: false, message: `AI 助手不可用（${res.status}）` };
    const body = (await res.json()) as { enabled: boolean; message?: string; backend?: string; model?: string };
    if (!body.enabled) return { enabled: false, message: body.message ?? "AI 助手未启用" };
    const detail = body.backend === "codex"
      ? (body.model ? `本机 Codex（${body.model}）` : "本机 Codex")
      : (body.model ?? "API");
    return { enabled: true, detail };
  } catch {
    return { enabled: false, message: "AI 助手不可用：连不上服务端" };
  }
}

/**
 * Wraps the app in CopilotKit when the server has a backend. The status is
 * settled before children render, so the tree (and editor state) never
 * remounts when the provider appears.
 */
export function AssistantProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = React.useState<AssistantStatus | null>(null);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void fetchStatus().then((s) => {
      if (!cancelled) setStatus(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = React.useMemo(() => status && { status, open, setOpen }, [status, open]);

  if (!value) return null;
  if (!value.status.enabled) return <AssistantContext value={value}>{children}</AssistantContext>;
  return (
    <AssistantContext value={value}>
      <CopilotKitProvider runtimeUrl={RUNTIME_URL}>
        {children}
        <CopilotSidebar
          labels={LABELS}
          open={open}
          onOpenChange={setOpen}
          toggleButton={HIDDEN_TOGGLE}
          width={380}
          className="assistant-chat"
        />
      </CopilotKitProvider>
    </AssistantContext>
  );
}
