import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";

import { DiagnosticsPanel, RunDiagnosticsButton } from "../components/diagnostics-panel";

const meta = {
  title: "Settings/DiagnosticsPanel",
  component: DiagnosticsPanel,
} satisfies Meta<typeof DiagnosticsPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Panel: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: /导出诊断包/ })).toBeEnabled();
    await expect(canvas.getByText(/API key 只记录是否已设置/)).toBeInTheDocument();
  },
};

export const RunButton: Story = {
  render: () => <RunDiagnosticsButton runId="run_story" />,
};
