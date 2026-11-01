import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";

import { KernelPicker } from "../components/kernel-picker";
import { ModuleEnvFields, ModuleEnvPreview } from "../components/module-env-form";

function KernelDemo() {
  const [kernel, setKernel] = React.useState("py311-pandas");
  return (
    <div className="glass flex items-center gap-3 rounded-xl px-3 py-2">
      <span className="text-xs text-muted-foreground">运行全部</span>
      <div className="ml-auto">
        <KernelPicker value={kernel} onChange={setKernel} />
      </div>
    </div>
  );
}

function EnvDemo() {
  const [condaYaml, setCondaYaml] = React.useState("");
  const [containerImage, setContainerImage] = React.useState("");
  return (
    <div className="glass grid w-full max-w-3xl gap-4 rounded-xl p-4 lg:grid-cols-2">
      <ModuleEnvFields
        condaYaml={condaYaml}
        containerImage={containerImage}
        onCondaYaml={setCondaYaml}
        onContainerImage={setContainerImage}
      />
      <ModuleEnvPreview condaYaml={condaYaml} containerImage={containerImage} />
    </div>
  );
}

const meta = {
  title: "Notebook/Kernel and env",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const KernelMenu: Story = {
  render: () => <KernelDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    const trigger = canvas.getByRole("button", { name: /Python 3\.11 · py311-pandas/ });
    await userEvent.click(trigger);
    await userEvent.click(body.getByRole("option", { name: "R 4.3 · r-deseq2" }));
    await expect(canvas.getByRole("button", { name: /R 4\.3 · r-deseq2/ })).toBeInTheDocument();

    await userEvent.click(canvas.getByRole("button", { name: /R 4\.3 · r-deseq2/ }));
    await userEvent.click(body.getByRole("button", { name: "选其他…" }));
    await userEvent.type(body.getByRole("textbox", { name: "自定义内核" }), "python:3.12");
    await userEvent.click(body.getByRole("button", { name: "使用" }));
    await expect(canvas.getByRole("button", { name: /python:3\.12/ })).toBeInTheDocument();
  },
};

export const EnvFields: Story = {
  render: () => <EnvDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("status")).toHaveTextContent("未填写Conda yaml和容器地址");
    await userEvent.type(canvas.getByLabelText("Conda yaml 路径"), "/envs/py311-pandas.yml");
    await userEvent.type(canvas.getByLabelText("容器地址"), "ghcr.io/org/py311-pandas:1.2");
    await expect(canvas.getByText("conda '/envs/py311-pandas.yml'")).toBeInTheDocument();
    await expect(canvas.getByText(/container 'ghcr.io\/org\/py311-pandas:1\.2'/)).toBeInTheDocument();
    await expect(canvas.getByText(/试跑与 process 使用同一份/)).toHaveTextContent("/envs/py311-pandas.yml");
    await expect(canvas.getByText(/试跑与 process 使用同一份/)).toHaveTextContent("ghcr.io/org/py311-pandas:1.2");
    await expect(canvas.queryByRole("status")).toBeNull();
  },
};
