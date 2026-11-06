"use client";

import * as React from "react";
import type { CliBlocker } from "./backend";
import { useAssistantStatusQuery } from "./queries";
import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";
import { ComposerProvider } from "./composer";
import { AssistantModuleHost } from "./modules/activation";
import { ASSISTANT_MODULES_PROP } from "./modules/contract";
import { useLayoutStore } from "@/components/layout/layout-store";
import { getProductTheme } from "@/lib/product-theme";

import { AssistantPanel } from "./assistant-panel";

const RUNTIME_URL = "/api/copilotkit";
const productName = getProductTheme().displayName;

const LABELS = {
  modalHeaderTitle: `${productName} AI 助手`,
  welcomeMessageText: "想分析什么？",
  chatInputPlaceholder: "输入问题或分析需求",
  chatDisclaimerText: "运行前请核对",
  chatToggleOpenLabel: "打开 AI 助手",
  chatToggleCloseLabel: "关闭 AI 助手",
  chatInputToolbarSendButtonLabel: "发送",
  chatInputToolbarStopButtonLabel: "停止",
  modalHeaderCloseButtonLabel: "关闭",
  reasoningMessageThinkingLabel: "思考中…",
  sidebarLabel: "AI 助手侧边栏",
};

/** Facts the settings page shows; the header button only needs `detail` / `message`. */
export interface AssistantStatusFacts {
  /** Backend actually in use (or the forced one that failed). */
  backend?: string;
  model?: string;
  /** Why the assistant is off, e.g. `codex-unauthenticated`, `missing-key`. */
  reason?: string;
  /** API key env var the built-in backend still needs. */
  missing?: string;
  /** Why `auto` skipped a local CLI. */
  codex?: CliBlocker;
  grok?: CliBlocker;
}

export type AssistantStatus =
  | ({ enabled: true; detail: string } & AssistantStatusFacts)
  | ({ enabled: false; message: string } & AssistantStatusFacts);

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

/**
 * Wraps the app in CopilotKit when the server has a backend. The status is
 * settled before children render, so the tree (and editor state) never
 * remounts when the provider appears.
 */
function sameStringList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

/**
 * The panel takes width from the page, so opening it folds the main navigation to its icon rail. Only the opening
 * itself does: a nav the user opens again stays open, and closing the panel unfolds the nav only if this folded it.
 */
function useFoldNavWhileOpen(open: boolean) {
  const folded = React.useRef(false);
  React.useEffect(() => {
    const { panels, setPanel } = useLayoutStore.getState();
    if (open) {
      if (panels.nav.collapsed) return;
      setPanel("nav", { ...panels.nav, collapsed: true });
      folded.current = true;
    } else if (folded.current) {
      folded.current = false;
      if (panels.nav.collapsed) setPanel("nav", { ...panels.nav, collapsed: false });
    }
  }, [open]);
}

export function AssistantProvider({ children }: { children: React.ReactNode }) {
  const { data: status } = useAssistantStatusQuery();
  const [open, setOpen] = React.useState(false);
  useFoldNavWhileOpen(open);
  const [modules, setModules] = React.useState<readonly string[]>([]);
  const onModules = React.useCallback((ids: readonly string[]) => {
    setModules((current) => (sameStringList(current, ids) ? current : ids));
  }, []);
  const properties = React.useMemo(
    () => ({ [ASSISTANT_MODULES_PROP]: [...modules] }),
    [modules],
  );

  const value = React.useMemo(
    () => status && { status, open, setOpen },
    [status, open],
  );

  if (!value) return null;
  const chat = !value.status.enabled ? (
    children
  ) : (
    <CopilotKitProvider runtimeUrl={RUNTIME_URL} properties={properties}>
      <ComposerProvider>
        <AssistantPanel open={open} onOpenChange={setOpen} labels={LABELS}>
          {children}
        </AssistantPanel>
      </ComposerProvider>
    </CopilotKitProvider>
  );
  return (
    <AssistantModuleHost onChange={onModules}>
      <AssistantContext value={value}>{chat}</AssistantContext>
    </AssistantModuleHost>
  );
}
