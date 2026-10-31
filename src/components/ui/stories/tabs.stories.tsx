import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../tabs";
import { expect, userEvent, within } from "storybook/test";

const meta = { title: "UI/Tabs", component: Tabs, args: {} } satisfies Meta<
  typeof Tabs
>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Tabs defaultValue="graph">
      <TabsList aria-label="运行详情">
        <TabsTrigger value="graph">流程图</TabsTrigger>
        <TabsTrigger value="log">日志</TabsTrigger>
      </TabsList>
      <TabsContent value="graph">流程节点</TabsContent>
      <TabsContent value="log">运行日志</TabsContent>
    </Tabs>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("tab", { name: "日志" }));
    await expect(canvas.getByRole("tabpanel")).toHaveTextContent("运行日志");
  },
};
