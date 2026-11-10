import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { SettingsForm } from "../components/settings-form";
import { defaultSettings, SECRET_KEYS, type SettingsView } from "../types";

const meta = {
  title: "Settings/SettingsForm",
  component: SettingsForm,
  args: {
    onSave: fn(),
    view: {
      settings: defaultSettings(),
      secrets: { ...(Object.fromEntries(SECRET_KEYS.map((key) => [key, false])) as SettingsView["secrets"]), ANTHROPIC_API_KEY: true },
      secretStorage: "keychain",
      environmentOverrides: ["NEXTFLOW_BIN"],
      runnerRestartNeeded: false,
    },
  },
} satisfies Meta<typeof SettingsForm>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("由环境变量 NEXTFLOW_BIN 覆盖")).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: /保存设置/ })).toBeDisabled();
    await userEvent.type(canvas.getByLabelText("本机最多 CPU"), "8");
    await userEvent.type(canvas.getByLabelText("OpenAI API key"), "sk-test-123456");
    await userEvent.click(canvas.getByRole("button", { name: /保存设置/ }));
    await expect(args.onSave).toHaveBeenCalledWith(expect.objectContaining({ secrets: { OPENAI_API_KEY: "sk-test-123456" } }));
  },
};

export const NextflowEnvironment: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const setup = canvas.getByRole("textbox", { name: "Nextflow 启动前命令（Bash）" });
    await userEvent.type(setup, "source ~/miniconda3/etc/profile.d/conda.sh{Enter}conda activate bia-main");
    await userEvent.click(canvas.getByRole("button", { name: /保存设置/ }));
    await expect(args.onSave).toHaveBeenCalledWith(expect.objectContaining({
      settings: expect.objectContaining({ runtime: expect.objectContaining({
        nextflowSetup: "source ~/miniconda3/etc/profile.d/conda.sh\nconda activate bia-main",
      }) }),
    }));
    await userEvent.clear(setup);
    await expect(canvas.getByRole("button", { name: /保存设置/ })).toBeDisabled();
  },
};

export const NextflowVersion: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("combobox", { name: "Nextflow 版本" }));
    await userEvent.click(within(document.body).getByRole("option", { name: "最新稳定版" }));
    await expect(canvas.queryByLabelText("指定版本号")).not.toBeInTheDocument();
    await userEvent.click(await canvas.findByRole("button", { name: /保存设置/ }));
    await expect(args.onSave).toHaveBeenCalledWith(expect.objectContaining({ settings: expect.objectContaining({ runtime: expect.objectContaining({ nextflowVersion: "latest" }) }) }));
    await userEvent.click(await canvas.findByRole("combobox", { name: "Nextflow 版本" }));
    await userEvent.click(within(document.body).getByRole("option", { name: "指定版本" }));
    const input = await canvas.findByLabelText("指定版本号");
    // Radix Select leaves pointer-events: none on <body> for a moment after it closes.
    await waitFor(() => expect(document.body.style.pointerEvents).not.toBe("none"));
    await userEvent.clear(input);
    await userEvent.type(input, "26.10.5");
    await userEvent.click(canvas.getByRole("button", { name: /保存设置/ }));
    await expect(args.onSave).toHaveBeenCalledWith(expect.objectContaining({ settings: expect.objectContaining({ runtime: expect.objectContaining({ nextflowVersion: "26.10.5" }) }) }));
  },
};

export const AssistantCodexReady: Story = {
  args: { assistantStatus: { status: { enabled: true, detail: "本机 Codex（gpt-5-codex）", backend: "codex", model: "gpt-5-codex" }, refresh: fn() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("当前使用 本机 Codex")).toBeInTheDocument();
    await expect(canvas.getByText("已登录")).toBeInTheDocument();
  },
};

export const AssistantNeedsLogin: Story = {
  args: {
    view: { ...meta.args.view, settings: { ...defaultSettings(), assistant: { backend: "grok" } }, environmentOverrides: ["GROK_MODEL"] },
    assistantStatus: { status: { enabled: false, message: "AI 助手未启用：请先运行 grok login", backend: "grok", reason: "grok-unauthenticated" }, refresh: fn() },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("未登录")).toBeInTheDocument();
    await expect(canvas.queryByLabelText("Anthropic API key")).not.toBeInTheDocument();
    await expect(canvas.getByLabelText("Grok 模型")).toBeInTheDocument();
    await expect(canvas.getByText("由环境变量 GROK_MODEL 覆盖")).toBeInTheDocument();
  },
};

export const AssistantMissingKey: Story = {
  args: {
    view: { ...meta.args.view, settings: { ...defaultSettings(), assistant: { backend: "builtin" } } },
    assistantStatus: { status: { enabled: false, message: "AI 助手未启用：服务端没有设置 ANTHROPIC_API_KEY", backend: "builtin", reason: "missing-key", missing: "ANTHROPIC_API_KEY" } },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("未启用")).toBeInTheDocument();
    await expect(canvas.queryByLabelText("Codex 模型")).not.toBeInTheDocument();
  },
};
