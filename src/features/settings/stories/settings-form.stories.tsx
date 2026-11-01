import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { SettingsForm } from "../components/settings-form";
import { defaultSettings } from "../types";

const meta = {
  title: "Settings/SettingsForm",
  component: SettingsForm,
  args: {
    onSave: fn(),
    view: {
      settings: defaultSettings(),
      secrets: { ANTHROPIC_API_KEY: true, OPENAI_API_KEY: false, GOOGLE_API_KEY: false },
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
    await expect(canvas.getByText("环境变量 NEXTFLOW_BIN 已设置，以它为准")).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: /保存设置/ })).toBeDisabled();
    await userEvent.type(canvas.getByLabelText("本机最多 CPU"), "8");
    await userEvent.type(canvas.getByLabelText("OpenAI API key"), "sk-test-123456");
    await userEvent.click(canvas.getByRole("button", { name: /保存设置/ }));
    await expect(args.onSave).toHaveBeenCalledWith(expect.objectContaining({ secrets: { OPENAI_API_KEY: "sk-test-123456" } }));
  },
};
