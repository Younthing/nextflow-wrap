"use client";

import * as React from "react";
import { useAssistantStatusQuery } from "./queries";
import { CopilotKitProvider, CopilotSidebar } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";

const RUNTIME_URL = "/api/copilotkit";

const LABELS = {
  modalHeaderTitle: "AI 助手",
  welcomeMessageText:
    "我可以帮你搭流程、启动运行，或者解释一次运行为什么失败。启动、停止和恢复都会先请你确认。",
  chatInputPlaceholder: "描述你想做的事…",
  chatDisclaimerText:
    "AI 可能出错，运行前请检查流程。启动、停止和恢复需要你确认。画布改动都能撤销。",
  chatToggleOpenLabel: "打开 AI 助手",
  chatToggleCloseLabel: "关闭 AI 助手",
  chatInputToolbarSendButtonLabel: "发送",
  chatInputToolbarStopButtonLabel: "停止",
  modalHeaderCloseButtonLabel: "关闭",
  reasoningMessageThinkingLabel: "思考中…",
  sidebarLabel: "AI 助手侧边栏",
};

export type AssistantStatus =
  | { enabled: true; detail: string }
  | { enabled: false; message: string };

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
export const useAssistantStatus = () =>
  React.useContext(AssistantContext).status;
export const useAssistantPanel = () => React.useContext(AssistantContext);

/** The sidebar opens from the header button, not CopilotKit's floating one. */
const HIDDEN_TOGGLE = { style: { display: "none" } };

/**
 * Wraps the app in CopilotKit when the server has a backend. The status is
 * settled before children render, so the tree (and editor state) never
 * remounts when the provider appears.
 */
export function AssistantProvider({ children }: { children: React.ReactNode }) {
  const { data: status } = useAssistantStatusQuery();
  const [open, setOpen] = React.useState(false);

  const value = React.useMemo(
    () => status && { status, open, setOpen },
    [status, open],
  );

  if (!value) return null;
  if (!value.status.enabled)
    return <AssistantContext value={value}>{children}</AssistantContext>;
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
