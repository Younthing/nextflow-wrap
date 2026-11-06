import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, waitFor, within } from "storybook/test";
import { CopilotKitProvider, CopilotChatConfigurationProvider, CopilotChatView } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";

import { AssistantChatInput } from "../composer";

const meta = {
  title: "Assistant/Liquid glass",
  parameters: { layout: "fullscreen" },
} satisfies Meta;
export default meta;

/** Use the real chat renderers without a model call, including the nonempty thread path. */
export const Conversation: StoryObj = {
  render: () => (
    <CopilotKitProvider showDevConsole={false}>
    <CopilotChatConfigurationProvider labels={{ chatDisclaimerText: "AI 可能出错，运行前请检查" }}>
      <div className="h-[680px] w-full max-w-md">
        <aside className="copilotKitSidebar flex h-full flex-col" data-copilotkit data-copilot-sidebar>
          <header className="assistant-panel-header text-sm font-medium">Fluora AI 助手</header>
          <div className="min-h-0 flex-1" data-sidebar-chat>
            <CopilotChatView
              messages={[
                { id: "user", role: "user", content: "检查当前分析流程" },
                { id: "assistant", role: "assistant", content: "当前流程包含质控、标准化、PCA 和分组比较。\n\n请检查样本分组后再运行。\n\n```python\nprint(samples.shape)\n```" },
              ]}
              input={AssistantChatInput}
            />
          </div>
        </aside>
      </div>
    </CopilotChatConfigurationProvider>
    </CopilotKitProvider>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("检查当前分析流程")).toBeVisible();
    for (const selector of [".copilotKitMessages", ".copilotKitUserMessage", ".copilotKitAssistantMessage", ".assistant-composer > [data-copilotkit]"]) {
      const element = canvasElement.querySelector(selector);
      await expect(element).not.toBeNull();
      await expect(getComputedStyle(element!).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    }
    const bubble = canvasElement.querySelector(".copilotKitUserMessage .cpk\\:prose")!;
    await expect(getComputedStyle(bubble).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    await waitFor(() => expect(canvasElement.querySelector('pre span[style*="--shiki-dark"]')).not.toBeNull());
    const token = canvasElement.querySelector<HTMLElement>('pre span[style*="--shiki-dark"]')!;
    await expect(token).not.toBeNull();
    if (document.documentElement.classList.contains("dark")) {
      await expect(getComputedStyle(token).color).not.toBe(token.style.color);
    } else {
      await waitFor(() => expect(getComputedStyle(token).color).toBe(token.style.color));
    }
    // Removing wrapper backgrounds must not remove the input field's own surface.
    const input = canvasElement.querySelector(".copilotKitInput")!;
    await expect(getComputedStyle(input).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  },
};

export const NightConversation: StoryObj = { ...Conversation, globals: { theme: "dark" } };
export const DayConversation: StoryObj = { ...Conversation, globals: { theme: "light" } };
