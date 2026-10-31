import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Badge } from "../badge";

const meta = { title: "UI/Badge", component: Badge, args: {} } satisfies Meta<
  typeof Badge
>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { children: "运行中" } };
export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {(
        [
          "default",
          "secondary",
          "success",
          "warning",
          "destructive",
          "outline",
        ] as const
      ).map((variant) => (
        <Badge key={variant} variant={variant}>
          {variant}
        </Badge>
      ))}
    </div>
  ),
};
