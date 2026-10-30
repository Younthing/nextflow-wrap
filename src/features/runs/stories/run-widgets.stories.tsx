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

export const DiscoveringTasks: Story = {
  render: () => (
    <div className="grid w-80 gap-3 text-sm">
      <StatusBadge status="submitted" />
      <p className="text-muted-foreground">正在准备项目和安装依赖</p>
      <ProgressBar progress={{ total: 0, pending: 0, running: 0, completed: 0, cached: 0, failed: 0, aborted: 0 }} />
      <p className="text-xs text-muted-foreground">已发现 0 · 完成 0；任务数量随流程展开更新。</p>
    </div>
  ),
};
