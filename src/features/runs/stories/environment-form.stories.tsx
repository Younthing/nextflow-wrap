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
export const Local: Story = {};
export const RealRunner: Story = { args: { real: true } };
export const ChangeExecutor: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const option = canvas.getByRole("radio", { name: /Slurm/i });
    await userEvent.click(option);
    await expect(option).toHaveAttribute("aria-checked", "true");
  },
};
