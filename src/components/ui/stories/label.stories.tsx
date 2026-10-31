import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Label } from "../label";
import { Input } from "../input";

const meta = { title: "UI/Label", component: Label, args: {} } satisfies Meta<
  typeof Label
>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="grid max-w-sm gap-2">
      <Label htmlFor="label-example">流程名称</Label>
      <Input id="label-example" />
    </div>
  ),
};
