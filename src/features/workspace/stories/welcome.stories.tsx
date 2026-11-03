import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import type { Project } from "@/features/workspace/types";
import { BackendCardView } from "../components/backend-card";
import { BackendManagerView } from "../components/backend-manager-dialog";
import { NewProjectDialog } from "../components/new-project-dialog";
import { WelcomeView } from "../components/welcome-page";

const hour = 3_600_000;
const at = (ago: number) => new Date(Date.now() - ago).toISOString();
const projects: Project[] = [
  { id: "p1", name: "PBMC 单细胞图谱", path: "/home/demo/Projects/pbmc-atlas", createdAt: at(90 * 24 * hour), openedAt: at(0.2 * hour) },
  { id: "p2", name: "EGFR 抑制剂对接筛选", path: "/home/demo/Projects/egfr-docking", createdAt: at(60 * 24 * hour), openedAt: at(26 * hour) },
  { id: "p3", name: "空间转录组试点", path: "/data/lab/visium-pilot", createdAt: at(30 * 24 * hour), openedAt: at(12 * 24 * hour) },
  { id: "example", name: "示例项目", path: "/home/demo/.local/share/nextflow-studio/projects/example", createdAt: at(90 * 24 * hour), openedAt: at(90 * 24 * hour) },
];

const meta = {
  title: "Workspace/Welcome",
  component: WelcomeView,
  args: {
    projects,
    home: "/home/demo",
    backend: <BackendCardView kind="wsl" label="WSL · Ubuntu-24.04" detail="WSL · Ubuntu-24.04" state="ok" serverVersion="0.2.0" build="20261103115203-a1b2c3" nextflow="26.10.4" manageable onRun={fn()} onManage={fn()} />,
    shortcuts: { newProject: "Ctrl+Shift+N", openDirectory: "Ctrl+O" },
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

/** In a browser: the card shows the answering server, without desktop actions or shortcut hints. */
export const Browser: Story = {
  args: {
    shortcuts: undefined,
    backend: <BackendCardView label="当前服务端" state="degraded" serverVersion="0.2.0" nextflow="未就绪" manageable={false} />,
  },
};

/** A development shell whose server does not answer. */
export const BackendOffline: Story = {
  args: {
    backend: <BackendCardView kind="wsl" label="WSL · Ubuntu-24.04" state="offline" manageable dev onRun={fn()} onManage={fn()} />,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "更多后端操作" }));
    await expect(within(document.body).getByRole("menuitem", { name: /用当前代码重新构建/ })).toBeVisible();
  },
};

export const BackendManager: StoryObj<typeof BackendManagerView> = {
  render: () => (
    <div className="glass w-[32rem] rounded-2xl p-6">
      <BackendManagerView
        list={{
          currentId: "wsl-ubuntu-24-04",
          platform: "win32",
          localAvailable: false,
          connections: [
            { id: "wsl-ubuntu-24-04", kind: "wsl", label: "WSL · Ubuntu-24.04", distro: "Ubuntu-24.04" },
            { id: "ssh-gpu", kind: "ssh", label: "gpu01", target: "me@gpu01", port: 2222 },
            { id: "url-dev", kind: "url", label: "127.0.0.1:3000", url: "http://127.0.0.1:3000" },
          ],
        }}
        distros={["Ubuntu-24.04", "Debian"]}
        onConnect={fn()}
        onCreate={fn()}
        onRemove={fn()}
        onInstallWsl={fn()}
      />
    </div>
  ),
};

export const NewProject: StoryObj<typeof NewProjectDialog> = {
  render: () => (
    <NewProjectDialog open onOpenChange={() => {}} defaultParent="/home/demo/Projects" onCreate={() => {}} error="/home/demo/Projects/atlas 已存在且不是空目录，请用「打开目录」" />
  ),
};
