import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";
import { RunDialog } from "../components/run-dialog";
import {
  EditorFixture,
  storyCatalog,
} from "@/features/editor/stories/fixtures";
const meta = {
  title: "Runs/RunDialog",
  component: RunDialog,
  args: {
    open: true,
    onOpenChange: fn(),
    issues: [],
    modulesSha: storyCatalog.gitSha,
  },
  decorators: [
    (Story) => (
      <EditorFixture>
        <Story />
      </EditorFixture>
    ),
  ],
} satisfies Meta<typeof RunDialog>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Ready: Story = {};
export const Invalid: Story = {
  args: { issues: [{ level: "error", message: "缺少输入样本表" }] },
};
