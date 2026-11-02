import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { EnvironmentForm } from "../components/environment-form";
import { defaultLaunchConfig } from "@/features/project/launch";
import { DEMO_REMOTE_HOST } from "@/mocks/remotes";

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
    await expect(canvas.getByText(/模拟运行，不连接真实执行器/)).toBeInTheDocument();
    expect(canvas.getAllByText("预览")).toHaveLength(1);
  },
};
export const RealRunner: Story = {
  args: { real: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.queryByText(/模拟运行，不连接/)).toBeNull();
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
export const OnCluster: Story = {
  args: { real: true, remotes: [DEMO_REMOTE_HOST] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText("工作目录（workDir）")).toBeDisabled();
    await userEvent.click(canvas.getByLabelText("从哪里启动 Nextflow"));
    await userEvent.click(await within(document.body).findByRole("option", { name: /实验室集群/ }));
    // On a cluster only the login node and its schedulers are offered; cloud services start from this machine.
    // The listbox keeps the form aria-hidden until it has closed.
    await expect(await canvas.findByRole("radio", { name: /^登录节点/ })).toHaveAttribute("aria-checked", "true");
    expect(canvas.queryByRole("radio", { name: /AWS Batch/ })).toBeNull();
    await expect(canvas.getByText(/路径写集群上的路径/)).toBeInTheDocument();
    await expect(canvas.getByLabelText("工作目录（workDir）")).toBeEnabled();
    await expect(canvas.getByText("填 work 时用 ~/nextflow-studio/work")).toBeInTheDocument();
    const slurm = canvas.getByRole("radio", { name: /^SLURM/ });
    await expect(slurm).toHaveAccessibleName(/Nextflow 在登录节点上提交作业/);
    await userEvent.click(slurm);
    await expect(slurm).toHaveAttribute("aria-checked", "true");
  },
};
