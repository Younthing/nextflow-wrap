import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { delay, http, HttpResponse } from "msw";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { AssistantButton } from "../assistant-button";
import { AssistantProvider } from "../assistant-provider";

/** The workbench renders before `/api/copilotkit/status` answers; only the sidebar button waits for it. */
function Workbench() {
  return (
    <AssistantProvider>
      <div className="flex h-[360px] gap-4">
        <nav className="glass w-56 rounded-xl p-2">
          <AssistantButton />
        </nav>
        <main className="glass flex-1 rounded-xl p-4">
          <label className="flex flex-col gap-2 text-sm">
            笔记本单元格
            <textarea className="min-h-32 rounded-md border bg-background p-2 font-mono" defaultValue="" />
          </label>
        </main>
      </div>
    </AssistantProvider>
  );
}

const meta = {
  title: "Assistant/Status",
  render: () => <Workbench />,
} satisfies Meta;
export default meta;

const status = (handler: Parameters<typeof http.get>[1]) => ({ msw: [http.get("/api/copilotkit/status", handler)] });

/** The status never answers: the page is usable and the button shows a spinner. */
export const Checking: StoryObj = {
  parameters: status(async () => {
    await delay("infinite");
    return HttpResponse.json({});
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const cell = await canvas.findByRole("textbox", { name: "笔记本单元格" });
    await userEvent.type(cell, "adata.obs.head()");
    await expect(cell).toHaveValue("adata.obs.head()");
    const button = canvas.getByRole("button", { name: "AI 助手" });
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute("aria-busy", "true");
  },
};

/** Text typed while the status is checked survives its arrival: the tree does not remount. */
export const SlowStatus: StoryObj = {
  parameters: status(async () => {
    await delay(600);
    return HttpResponse.json({ enabled: false, reason: "missing-key", missing: "ANTHROPIC_API_KEY", message: "AI 助手未启用：服务端没有设置 ANTHROPIC_API_KEY" });
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const cell = await canvas.findByRole("textbox", { name: "笔记本单元格" });
    await userEvent.type(cell, "print(1)");
    const button = canvas.getByRole("button", { name: "AI 助手" });
    await waitFor(() => expect(button).not.toHaveAttribute("aria-busy"), { timeout: 3_000 });
    await expect(button).toBeDisabled();
    await expect(canvas.getByRole("textbox", { name: "笔记本单元格" })).toHaveValue("print(1)");
  },
};

/** The status endpoint is down: the page still works and the button says why the assistant is off. */
export const Unreachable: StoryObj = {
  parameters: status(() => HttpResponse.error()),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("textbox", { name: "笔记本单元格" })).toBeEnabled();
    const button = canvas.getByRole("button", { name: "AI 助手" });
    await waitFor(() => expect(button).not.toHaveAttribute("aria-busy"));
    await expect(button).toBeDisabled();
  },
};
