import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import type { Project } from "@/features/workspace/types";
import { NewProjectDialog } from "../components/new-project-dialog";
import { WelcomeView } from "../components/welcome-page";

const hour = 3_600_000;
const at = (ago: number) => new Date(Date.now() - ago).toISOString();
const projects: Project[] = [
  { id: "p1", name: "PBMC 单细胞图谱", path: "/home/demo/Projects/pbmc-atlas", createdAt: at(90 * 24 * hour), openedAt: at(0.2 * hour) },
  { id: "p2", name: "EGFR 抑制剂对接筛选", path: "/home/demo/Projects/egfr-docking", createdAt: at(60 * 24 * hour), openedAt: at(26 * hour) },
  { id: "p3", name: "空间转录组试点", path: "/data/lab/visium-pilot", createdAt: at(30 * 24 * hour), openedAt: at(12 * 24 * hour) },
  { id: "example", name: "示例项目", path: "/home/demo/.local/share/nextflow-studio/projects/example", createdAt: at(90 * 24 * hour), openedAt: "1970-01-01T00:00:00.000Z", example: true },
];

const meta = {
  title: "Workspace/Welcome",
  component: WelcomeView,
  args: {
    projects,
    home: "/home/demo",
    environment: "Nextflow 26.10.4 · 运行环境正常",
    onNew: fn(),
    onOpenDirectory: fn(),
    onOpen: fn(),
    onForget: fn(),
  },
  decorators: [
    (Story) => (
      <div className="h-[720px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof WelcomeView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Recent: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("~/Projects/pbmc-atlas")).toBeVisible();
    await userEvent.type(canvas.getByRole("textbox", { name: "搜索项目" }), "visium");
    await expect(canvas.queryByText("PBMC 单细胞图谱")).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: /^空间转录组试点/ }));
    await expect(args.onOpen).toHaveBeenCalledWith(projects[2]);
  },
};

export const FirstLaunch: Story = { args: { projects: [projects[3]] } };

export const Empty: Story = { args: { projects: [] } };

export const Dark: Story = { globals: { theme: "dark" } };

export const NewProject: StoryObj<typeof NewProjectDialog> = {
  render: () => (
    <NewProjectDialog open onOpenChange={() => {}} defaultParent="/home/demo/Projects" onCreate={() => {}} error="/home/demo/Projects/atlas 已存在且不是空目录，请用「打开目录」" />
  ),
};
