import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { DEMO_REMOTE_HOST, sampleProbe } from "@/mocks/remotes";
import { RemoteHostsEditor } from "../components/remote-hosts-editor";
import { RemoteResultsNotice } from "../components/remote-results-notice";
import type { RemoteHost, RemoteProbe } from "../types";

const meta = {
  title: "Settings/RemoteHostsEditor",
  component: RemoteHostsEditor,
  args: {
    hosts: [DEMO_REMOTE_HOST],
    onSave: fn(),
    onTest: fn(async (host: RemoteHost) => sampleProbe(host)),
  },
} satisfies Meta<typeof RemoteHostsEditor>;
export default meta;
type Story = StoryObj<typeof meta>;

export const TestAndSave: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /测试连接/ }));
    await expect(await canvas.findByText("连接成功")).toBeInTheDocument();
    await expect(canvas.getByText("sbatch")).toBeInTheDocument();
    await expect(canvas.getByText("/home/you/nextflow-studio")).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: /保存集群设置/ })).toBeDisabled();
    await userEvent.click(canvas.getByRole("button", { name: /添加集群/ }));
    await userEvent.type(canvas.getAllByLabelText("主机").at(-1)!, "gpu-login.example.org");
    await userEvent.click(canvas.getByRole("button", { name: /保存集群设置/ }));
    await expect(args.onSave).toHaveBeenCalledWith([DEMO_REMOTE_HOST, expect.objectContaining({ id: "cluster-2", host: "gpu-login.example.org", baseDir: "~/nextflow-studio" })]);
  },
};

const failed: RemoteProbe = { ok: false, schedulers: [], runtimes: [], error: "you@login.hpc.example.org：SSH 认证失败。桌面版不能输入密码，请配置密钥（ssh-agent 或「私钥文件」）。\nPermission denied (publickey)." };

export const AuthenticationFails: Story = {
  args: { onTest: fn(async (host: RemoteHost) => ({ ...failed, error: failed.error?.replace("login.hpc.example.org", host.host) })) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /测试连接/ }));
    await expect(await canvas.findByRole("alert")).toHaveTextContent("SSH 认证失败");
  },
};

export const Empty: Story = { args: { hosts: [] } };

export const ResultsLeftOnCluster: Story = {
  render: () => (
    <div className="grid max-w-2xl gap-2">
      <RemoteResultsNotice host="实验室集群" active remote={undefined} />
      <RemoteResultsNotice host="实验室集群" active={false} remote={{ hostId: "hpc-lab", hostName: "实验室集群", launchDir: "/home/you/nextflow-studio/pipelines/wf", attemptDir: "/home/you/nextflow-studio/runs/r1", outdir: "/home/you/nextflow-studio/runs/r1/results", workDir: "/home/you/nextflow-studio/work", resultsLeftRemote: true, resultsBytes: 5.4 * 1024 ** 3 }} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/超过取回上限/)).toBeInTheDocument();
  },
};
