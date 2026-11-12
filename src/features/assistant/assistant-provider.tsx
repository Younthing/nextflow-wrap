"use client";

import * as React from "react";
import type { CliBlocker } from "./backend";
import { useAssistantStatusQuery } from "./queries";
import { CopilotKitProvider, HttpAgent } from "@copilotkit/react-core/v2";
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
  /** True until `/api/copilotkit/status` answers; the header button shows a spinner meanwhile. */
  checking: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
}

const AssistantContext = React.createContext<AssistantContextValue>({
  status: { enabled: false, message: "" },
  checking: false,
  open: false,
  setOpen: () => {},
});

/** Whether the server has a model configured; tool bridges render only then. */
export const useAssistantStatus = () =>
  React.useContext(AssistantContext).status;
export const useAssistantPanel = () => React.useContext(AssistantContext);

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

const CHECKING: AssistantStatus = { enabled: false, message: "正在检查 AI 助手…" };
const NO_AGENTS = {};

/**
 * Never runs: it only lets CopilotKit mount without a runtime while the assistant is off or still being checked.
 * Surfaces register tools and the panel mounts the chat only once the status says the assistant is on.
 */
class IdleAgent extends HttpAgent {
  constructor() {
    super({ url: RUNTIME_URL });
  }
  override clone() {
    return new IdleAgent();
  }
}

/**
 * Wraps the app in CopilotKit. Children render at once, before `/api/copilotkit/status` answers (it probes the
 * local Codex and Grok logins). The provider tree has the same shape whatever the status, so the workbench (and
 * editor state) never remounts when the status arrives: only the runtime URL and the panel switch on.
 */
export function AssistantProvider({ children }: { children: React.ReactNode }) {
  const { data } = useAssistantStatusQuery();
  const status = data ?? CHECKING;
  const checking = data === undefined;
  const [open, setOpen] = React.useState(false);
  useFoldNavWhileOpen(open && status.enabled);
  const [modules, setModules] = React.useState<readonly string[]>([]);
  const onModules = React.useCallback((ids: readonly string[]) => {
    setModules((current) => (sameStringList(current, ids) ? current : ids));
  }, []);
  const properties = React.useMemo(
    () => ({ [ASSISTANT_MODULES_PROP]: [...modules] }),
    [modules],
  );

  const [idleAgents] = React.useState(() => ({ idle: new IdleAgent() }));

  const value = React.useMemo(
    () => ({ status, checking, open: open && status.enabled, setOpen }),
    [status, checking, open],
  );

  return (
    <AssistantModuleHost onChange={onModules}>
      <AssistantContext value={value}>
        <CopilotKitProvider
          runtimeUrl={status.enabled ? RUNTIME_URL : undefined}
          agents__unsafe_dev_only={status.enabled ? NO_AGENTS : idleAgents}
          properties={properties}
        >
          <ComposerProvider>
            <AssistantPanel enabled={status.enabled} open={value.open} onOpenChange={setOpen} labels={LABELS}>
              {children}
            </AssistantPanel>
          </ComposerProvider>
        </CopilotKitProvider>
      </AssistantContext>
    </AssistantModuleHost>
  );
}
