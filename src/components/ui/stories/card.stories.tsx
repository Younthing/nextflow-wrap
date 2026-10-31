import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "../card";
import { Button } from "../button";

const meta = { title: "UI/Card", component: Card, args: {} } satisfies Meta<
  typeof Card
>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Card className="max-w-sm">
      <CardHeader>
        <CardTitle>质控流程</CardTitle>
        <CardDescription>样本质量检查</CardDescription>
      </CardHeader>
      <CardContent>FastQC → MultiQC</CardContent>
      <CardFooter>
        <Button>打开流程</Button>
      </CardFooter>
    </Card>
  ),
};
