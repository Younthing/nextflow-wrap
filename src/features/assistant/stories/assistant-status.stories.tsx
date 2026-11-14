import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { delay, http, HttpResponse } from "msw";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { AssistantButton } from "../assistant-button";
import { AssistantProvider } from "../assistant-provider";
import { historyKey } from "../history";
import { useFrontendTool } from "@copilotkit/react-core/v2";
import { z } from "zod";
import { useConfirmedTool } from "../confirmed-tool";
import { ConfirmToolCard } from "../confirm-tool-card";
import { ASSISTANT_ACTIVITY } from "../activity";
import { useToolNavigation } from "../tool-record";

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

export const EnabledAfterChecking: StoryObj = {
  parameters: { msw: [
    http.get("/api/copilotkit/status", async () => {
      await delay(600);
      return HttpResponse.json({ enabled: true, backend: "builtin", model: "test" });
    }),
    http.get("/api/copilotkit/info", () => HttpResponse.json({
      agents: { default: { name: "default", description: "Test agent", className: "HttpAgent" } },
      version: "1.0.0",
    })),
  ] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const cell = await canvas.findByRole("textbox", { name: "笔记本单元格" });
    await userEvent.type(cell, "print(1)");
    const assistantButton = () => canvas.getByRole("button", { name: "AI 助手" });
    await waitFor(() => expect(assistantButton()).toBeEnabled(), { timeout: 3_000 });
    await userEvent.click(assistantButton());
    await expect(await within(document.body).findByRole("button", { name: "收起 AI 助手" })).toBeVisible();
    await expect(cell).toHaveValue("print(1)");
  },
};

export const RestoreConversation: StoryObj = {
  parameters: { msw: [
    http.get("/api/copilotkit/status", () => HttpResponse.json({ enabled: true, backend: "builtin", model: "test" })),
    http.get("/api/copilotkit/info", () => HttpResponse.json({
      agents: { default: { name: "default", description: "Test agent", className: "HttpAgent" } },
      version: "1.0.0",
    })),
    http.get("/api/projects", () => HttpResponse.json({ projects: [] })),
  ] },
  beforeEach: () => {
    const key = historyKey("no-project");
    const previous = localStorage.getItem(key);
    localStorage.setItem(key, JSON.stringify([{
      id: "history-example",
      title: "已保存的分析",
      updatedAt: Date.now(),
      messages: [
        { id: "question", role: "user", content: "检查表格" },
        { id: "answer", role: "assistant", content: "本次分析发现两列缺失值。" },
      ],
    }]));
    return () => {
      if (previous === null) localStorage.removeItem(key);
      else localStorage.setItem(key, previous);
    };
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(document.body);
    const assistant = () => canvas.getByRole("button", { name: "AI 助手" });
    await waitFor(() => expect(assistant()).toBeEnabled());
    await userEvent.click(assistant());
    await userEvent.click(await body.findByRole("button", { name: "对话历史" }));
    await userEvent.click(await body.findByRole("menuitem", { name: "已保存的分析" }));
    await expect(await body.findByText("本次分析发现两列缺失值。")).toBeVisible();
    await userEvent.click(body.getByRole("button", { name: "新建对话" }));
    await waitFor(() => expect(body.queryByText("本次分析发现两列缺失值。")).toBeNull());
  },
};

function ExampleEdit() {
  const [source, setSource] = React.useState("print(1)");
  const [located, setLocated] = React.useState(false);
  const { invoke, dialog } = useConfirmedTool();
  useToolNavigation(React.useCallback((result) => {
    if (result.notebookId === "example" && result.edited === "cell") return () => setLocated(true);
  }, []));
  useFrontendTool({
    name: "edit_notebook_cell",
    description: "更新示例代码",
    parameters: z.object({}),
    handler: (_args, context) => invoke(context, {
      interruptedMessage: "已停止",
      prepare: () => ({
        view: {
          title: "修改单元格", message: "第 1 格", type: "default", itemList: [], problems: [],
          confirmLabel: "应用修改", declinedMessage: "已取消", preview: { before: source, after: "print(2)" },
        },
        problems: () => [],
        invoke: async () => {
          setSource("print(2)");
          return { accepted: true, message: "已修改单元格", notebookId: "example", edited: "cell" };
        },
      }),
    }),
    render: ConfirmToolCard,
  }, [source, invoke]);
  return <><output aria-label="单元格内容">{source}</output>{located && <span>已定位单元格</span>}{dialog}</>;
}

export const ReviewAndApply: StoryObj = {
  render: () => (
    <AssistantProvider>
      <AssistantButton />
      <ExampleEdit />
    </AssistantProvider>
  ),
  parameters: { msw: [
    http.get("/api/projects", () => HttpResponse.json({ projects: [] })),
    http.get("/api/copilotkit/status", () => HttpResponse.json({ enabled: true, backend: "builtin", model: "test" })),
    http.get("/api/copilotkit/info", () => HttpResponse.json({
      agents: { default: { name: "default", description: "Test agent", className: "HttpAgent" } },
      version: "1.0.0",
    })),
    http.post("/api/copilotkit/agent/default/run", async ({ request }) => {
      const input = await request.json() as { threadId: string; runId: string; messages: { role: string }[] };
      const events = input.messages.at(-1)?.role === "tool" ? [] : [
        { type: "ACTIVITY_SNAPSHOT", activityType: ASSISTANT_ACTIVITY, messageId: "activity", content: { label: "读取并分析", status: "completed" } },
        { type: "TOOL_CALL_START", toolCallId: "edit", toolCallName: "edit_notebook_cell", parentMessageId: "answer" },
        { type: "TOOL_CALL_ARGS", toolCallId: "edit", delta: "{}" },
        { type: "TOOL_CALL_END", toolCallId: "edit" },
      ];
      const envelope = { threadId: input.threadId, runId: input.runId };
      return new HttpResponse([
        { ...envelope, type: "RUN_STARTED" },
        ...events,
        { ...envelope, type: "RUN_FINISHED" },
      ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } });
    }),
  ] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(document.body);
    const button = () => canvas.getByRole("button", { name: "AI 助手" });
    await waitFor(() => expect(button()).toBeEnabled());
    await userEvent.click(button());
    const input = await body.findByPlaceholderText("输入问题或分析需求");
    await userEvent.type(input, "修改代码{Enter}");
    const apply = await body.findByRole("button", { name: "应用修改" }, { timeout: 6_000 });
    await expect(canvas.getByLabelText("单元格内容")).toHaveTextContent("print(1)");
    await expect(body.getByText("print(2)", { exact: true })).toBeVisible();
    await expect(body.getByText("读取并分析", { exact: true })).toBeInTheDocument();
    await userEvent.click(apply);
    await expect(canvas.getByLabelText("单元格内容")).toHaveTextContent("print(2)");
    await userEvent.click(await body.findByRole("button", { name: "定位结果" }));
    await expect(canvas.getByText("已定位单元格")).toBeVisible();
  },
};

export const QueueAndTitle: StoryObj = {
  parameters: { msw: [
    http.get("/api/projects", () => HttpResponse.json({ projects: [] })),
    http.get("/api/copilotkit/status", () => HttpResponse.json({ enabled: true, backend: "builtin", model: "test" })),
    http.get("/api/copilotkit/info", () => HttpResponse.json({
      agents: { default: { name: "default", description: "Test agent", className: "HttpAgent" } },
      version: "1.0.0",
    })),
    http.post("/api/copilotkit/title", () => HttpResponse.json({ title: "分析工作规划" })),
    http.post("/api/copilotkit/agent/default/run", async ({ request }) => {
      const input = await request.json() as { threadId: string; runId: string; messages: { role: string; content: string }[] };
      const last = input.messages.at(-1)?.content;
      await delay(last === "分析流程" ? 2200 : 150);
      const envelope = { threadId: input.threadId, runId: input.runId };
      return new HttpResponse([
        { ...envelope, type: "RUN_STARTED" },
        { type: "TEXT_MESSAGE_CHUNK", messageId: input.runId, role: "assistant", delta: `已处理：${last}` },
        { ...envelope, type: "RUN_FINISHED" },
      ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } });
    }),
  ] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(document.body);
    const assistant = () => canvas.getByRole("button", { name: "AI 助手" });
    await waitFor(() => expect(assistant()).toBeEnabled());
    await userEvent.click(assistant());
    const input = () => body.getByPlaceholderText("输入问题或分析需求");
    await userEvent.click(await body.findByRole("button", { name: "规划分析" }));
    await expect(input()).toHaveValue("帮我规划一次分析。先问我需要分析什么数据，以及想得到什么结果。");
    await userEvent.clear(input());
    await userEvent.type(input(), "分析流程{Enter}");
    await userEvent.type(input(), "检查数据");
    await userEvent.click(await body.findByRole("button", { name: "加入队列" }));
    await userEvent.type(input(), "定位失败{Enter}");
    const queue = within(await body.findByRole("region", { name: "消息队列" }));
    await userEvent.click(queue.getByRole("button", { name: "优先发送第 2 条消息" }));
    await expect(queue.getAllByRole("listitem")[0]).toHaveTextContent("定位失败");
    await userEvent.click(queue.getByRole("button", { name: "移除第 2 条消息" }));
    await userEvent.type(input(), "保留草稿");
    await expect(await body.findByText("已处理：定位失败", {}, { timeout: 7000 })).toBeVisible();
    await expect(input()).toHaveValue("保留草稿");
    await expect(await body.findByText("分析工作规划", {}, { timeout: 7000 })).toBeVisible();
    await expect(body.getByRole("button", { name: "规划分析" })).toBeVisible();
    await expect(body.queryByText("已处理：检查数据")).toBeNull();
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
