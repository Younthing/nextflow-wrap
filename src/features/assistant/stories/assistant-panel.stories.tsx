import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { CopilotKitProvider, HttpAgent, useConfigureSuggestions } from "@copilotkit/react-core/v2";
import { AssistantPanel } from "../assistant-panel";
import { ComposerProvider, useComposerReferences } from "../composer";

class OfflineAgent extends HttpAgent {
  constructor(private readonly empty = false) {
    super({ url: "/unused", initialMessages: empty ? [] : [{ id: "long", role: "assistant", content: Array.from({ length: 60 }, (_, i) => `分析步骤 ${i + 1}：检查输入数据与分析结果。`).join("\n\n") }] });
  }
  override clone() { return new OfflineAgent(this.empty); }
  override async connectAgent() { return { result: undefined, newMessages: [] }; }
}

function EmptyContext() {
  useConfigureSuggestions({ suggestions: [
    { title: "解释笔记本", message: "解释这本笔记本" },
    { title: "修复报错", message: "检查报错" },
    { title: "标注端口", message: "标注端口" },
  ] });
  const references = React.useMemo(() => ({ title: "变量", items: [], note: "内核还没启动。运行一个代码单元格后才有变量。" }), []);
  useComposerReferences(references);
  return null;
}

function PanelFixture({ empty = false }: { empty?: boolean }) {
  const [agents] = React.useState(() => ({ default: new OfflineAgent(empty) }));
  const [open, setOpen] = React.useState(true);
  return <CopilotKitProvider agents__unsafe_dev_only={agents} enableInspector={false}>
    <ComposerProvider>
    {empty ? <EmptyContext /> : null}
    <AssistantPanel open={open} onOpenChange={setOpen} labels={{ modalHeaderTitle: empty ? "Fluora AI 助手" : "AI 滚动回归", welcomeMessageText: "想分析什么？", chatInputPlaceholder: "输入问题或分析需求", chatDisclaimerText: "运行前请核对" }}>
      <div className="h-[720px]">工作区</div>
    </AssistantPanel>
    </ComposerProvider>
  </CopilotKitProvider>;
}

const meta = { title: "Assistant/Panel", render: () => <PanelFixture /> } satisfies Meta;
export default meta;

export const DragKeepsScroll: StoryObj = {
  play: async () => {
    const body = within(document.body);
    const header = await body.findByText("AI 滚动回归");
    await userEvent.click(body.getByRole("button", { name: "在应用内浮动" }));
    const surface = header.closest(".assistant-surface")!;
    await waitFor(() => expect(surface.querySelector('[data-testid="copilot-scroll-content"]')).not.toBeNull());
    const content = surface.querySelector('[data-testid="copilot-scroll-content"]')!;
    let scroll = content.parentElement!;
    while (scroll && (!(["auto", "scroll"].includes(getComputedStyle(scroll).overflowY)) || scroll.scrollHeight <= scroll.clientHeight + 100)) scroll = scroll.parentElement!;
    await waitFor(() => expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight + 100));
    await waitFor(() => expect(scroll.scrollTop).toBeGreaterThan(0));
    scroll.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true }));
    scroll.scrollTop = 180;
    scroll.dispatchEvent(new Event("scroll"));
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    const rect = header.getBoundingClientRect();
    await userEvent.pointer({ target: header, keys: "[MouseLeft>]", coords: { clientX: rect.left + 20, clientY: rect.top + 8 } });
    for (const offset of [24, 48, 72]) {
      await userEvent.pointer({ target: header, coords: { clientX: rect.left + 20 - offset, clientY: rect.top + 8 + offset } });
      await expect(content.isConnected).toBe(true);
      await expect(Math.abs(scroll.scrollTop - 180)).toBeLessThan(2);
    }
    await userEvent.pointer({ target: header, keys: "[/MouseLeft]" });
    await expect(content.isConnected).toBe(true);
    await expect(Math.abs(scroll.scrollTop - 180)).toBeLessThan(2);
  },
};

export const Welcome: StoryObj = {
  render: () => <PanelFixture empty />,
  play: async () => {
    const body = within(document.body);
    const input = await body.findByPlaceholderText("输入问题或分析需求");
    const panel = input.closest(".assistant-surface")!;
    const suggestions = await within(panel as HTMLElement).findByTestId("copilot-suggestions");
    await expect(getComputedStyle(suggestions).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    await expect(body.queryByText("内核还没启动。运行一个代码单元格后才有变量。")).toBeNull();
    await expect(input.getBoundingClientRect().height).toBeGreaterThanOrEqual(72);
    const field = panel.querySelector(".copilotKitInput")!;
    await expect(field.getBoundingClientRect().height).toBeGreaterThanOrEqual(140);
    await expect(field.getBoundingClientRect().width).toBeGreaterThan(panel.getBoundingClientRect().width * 0.85);
    await userEvent.type(input, "检查数据\n解释结果");
    await expect(input).toHaveValue("检查数据\n解释结果");
  },
};

export const WelcomeDark: StoryObj = { ...Welcome, globals: { theme: "dark" } };
export const WelcomeLight: StoryObj = { ...Welcome, globals: { theme: "light" } };
