import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { AppShell } from "../app-shell";
const meta = {
  title: "Layout/AppShell",
  component: AppShell,
  args: { children: <div className="glass h-full rounded-xl p-5">工作区</div> },
  decorators: [
    (Story) => (
      <div className="h-[640px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AppShell>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Light: Story = {};
export const Dark: Story = { globals: { theme: "dark" } };
