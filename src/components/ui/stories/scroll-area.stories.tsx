import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ScrollArea } from "../scroll-area";

const meta = {
  title: "UI/ScrollArea",
  component: ScrollArea,
  args: {},
} satisfies Meta<typeof ScrollArea>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <ScrollArea
      className="h-48 w-80 rounded-lg border p-4"
      aria-label="模块列表"
    >
      {Array.from({ length: 40 }, (_, i) => (
        <p key={i} className="py-1">
          Module {i + 1}
        </p>
      ))}
    </ScrollArea>
  ),
};
