import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { EnvironmentForm } from "../components/environment-form";
import { defaultLaunchConfig } from "@/features/project/launch";

const meta = {
  title: "Runs/EnvironmentForm",
  component: EnvironmentForm,
  args: { config: defaultLaunchConfig(), onChange: () => {} },
  render: function Controlled(args) {
    const [config, setConfig] = useState(args.config);
    return <EnvironmentForm {...args} config={config} onChange={setConfig} />;
  },
} satisfies Meta<typeof EnvironmentForm>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Local: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/预览环境不会连接真实的集群或云执行器/)).toBeInTheDocument();
    expect(canvas.getAllByText("预览")).toHaveLength(1);
  },
};
export const RealRunner: Story = {
  args: { real: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.queryByText(/预览环境不会连接/)).toBeNull();
    expect(canvas.getByLabelText("工作目录（workDir）")).toBeDisabled();
    const hq = canvas.getByRole("radio", { name: /HyperQueue/ });
    expect(hq).toBeEnabled();
    await userEvent.click(hq);
    await expect(hq).toHaveAttribute("aria-checked", "true");
    await expect(canvas.getByLabelText("工作目录（workDir）")).toBeEnabled();
    await expect(canvas.getByText(/计算节点也能访问；/)).toBeInTheDocument();
  },
};
export const ChangeExecutor: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const option = canvas.getByRole("radio", { name: /Slurm/i });
    await userEvent.click(option);
    await expect(option).toHaveAttribute("aria-checked", "true");
  },
};
