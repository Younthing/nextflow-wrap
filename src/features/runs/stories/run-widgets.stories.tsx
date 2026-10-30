import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { RUN_STATUS } from "../format";
import { ProgressBar, StatusBadge } from "../components/runs-table";
import type { RunStatus } from "../types";

const meta = {
  title: "Runs/Status",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Badges: Story = {
  render: () => (
    <div className="flex gap-2">
      {(Object.keys(RUN_STATUS) as RunStatus[]).map((s) => (
        <StatusBadge key={s} status={s} />
      ))}
    </div>
  ),
};

export const Progress: Story = {
  render: () => (
    <div className="grid w-80 gap-4">
      <ProgressBar progress={{ total: 13, pending: 6, running: 3, completed: 4, cached: 0, failed: 0, aborted: 0 }} />
      <ProgressBar progress={{ total: 13, pending: 0, running: 0, completed: 10, cached: 2, failed: 1, aborted: 0 }} />
      <ProgressBar progress={{ total: 13, pending: 5, running: 0, completed: 4, cached: 0, failed: 0, aborted: 4 }} />
    </div>
  ),
};
