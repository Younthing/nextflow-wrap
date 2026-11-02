import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { SetupWizardView } from "../components/setup-wizard";
import { sampleSetupStatus } from "../samples";

const meta = {
  title: "Setup/SetupWizard",
  component: SetupWizardView,
  args: { status: sampleSetupStatus("fresh"), onInstall: fn(), onRefresh: fn(), onDemo: fn(), demo: false },
} satisfies Meta<typeof SetupWizardView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const FreshMachine: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /下载 Temurin JRE/ }));
    await expect(args.onInstall).toHaveBeenCalledWith(expect.objectContaining({ id: "java" }));
    await expect(canvas.getByText("必需的工具就绪后可以开始")).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: /先进演示模式/ }));
    await expect(args.onDemo).toHaveBeenCalledWith(true);
  },
};

export const Installing: Story = { args: { status: sampleSetupStatus("installing") } };

export const Ready: Story = {
  args: { status: sampleSetupStatus("ready") },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("开始使用")).toBeInTheDocument();
    await expect(canvas.getByText("scanpy")).toBeInTheDocument();
  },
};
