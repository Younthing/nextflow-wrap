import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { NavRail } from "../nav-rail";

const meta = {
  title: "Layout/NavRail",
  component: NavRail,
  parameters: {
    nextjs: { navigation: { pathname: "/workflows" } },
  },
  decorators: [
    (Story) => (
      <div className="h-[28rem]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NavRail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Workflows: Story = {};

export const Editor: Story = {
  parameters: {
    nextjs: { navigation: { pathname: "/workflows/wf_demo" } },
  },
};

export const Runs: Story = {
  parameters: {
    nextjs: { navigation: { pathname: "/runs" } },
  },
};
