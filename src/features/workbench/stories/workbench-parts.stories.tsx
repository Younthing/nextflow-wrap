import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import type { NotebookSummary } from "@/features/notebook/types";
import { storyProject } from "@/mocks/story-handlers";
import { ExportMenu } from "../components/export-menu";
import { WorkbenchFiles } from "../components/workbench-files";
import { WorkbenchRuntimes } from "../components/workbench-runtimes";
import { WorkbenchStart } from "../components/workbench-start";
import { WorkbenchTabs } from "../components/workbench-tabs";

const notebooks: NotebookSummary[] = [
  { id: "nb_qc", name: "01 质控与过滤", description: "过滤低质量细胞", kernel: "py311-pandas", language: "python", rev: 4, updatedAt: "2026-01-02T11:50:00.000Z", projectId: storyProject.id },
  { id: "nb_umap", name: "02 降维与聚类", description: "PCA、Leiden、UMAP", kernel: "py311-pandas", language: "python", rev: 9, updatedAt: "2026-01-02T10:00:00.000Z", projectId: storyProject.id },
  { id: "nb_de", name: "03 差异表达", description: "DESeq2", kernel: "r-deseq2", language: "r", rev: 2, updatedAt: "2026-01-01T09:00:00.000Z", projectId: storyProject.id },
];

const meta = {
  title: "Workbench/Parts",
  parameters: { nextjs: { navigation: { pathname: "/workbench/nb_umap" } } },
} satisfies Meta;

export default meta;

/** Left column: the project's notebooks over its folder, runtimes at the bottom. */
export const LeftColumn: StoryObj = {
  render: () => (
    <aside className="glass flex h-[640px] w-62 flex-col gap-2 rounded-xl px-1.5 pt-3 pb-2">
      <WorkbenchFiles project={{ ...storyProject, path: "/home/demo/data" }} notebooks={notebooks} activeId="nb_umap" onCreate={fn()} />
      <WorkbenchRuntimes notebooks={notebooks} active={notebooks[1]} />
    </aside>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("link", { name: "02 降维与聚类" })).toHaveAttribute("aria-current", "page");
    await expect(await canvas.findByText("pbmc3k.h5ad")).toBeVisible();
    await expect(canvas.getByText("当前笔记本 · 未启动")).toBeVisible();
  },
};

export const Tabs: StoryObj<typeof WorkbenchTabs> = {
  render: (args) => (
    <div className="glass w-[48rem] rounded-xl">
      <WorkbenchTabs {...args} />
    </div>
  ),
  args: {
    tabs: notebooks.map((nb) => nb.id),
    names: Object.fromEntries(notebooks.map((nb) => [nb.id, nb.name])),
    active: "nb_umap",
    onClose: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("link", { name: "02 降维与聚类" })).toHaveAttribute("aria-current", "page");
    await userEvent.click(canvas.getByRole("button", { name: "关闭 02 降维与聚类" }));
    await expect(args.onClose).toHaveBeenCalledWith("nb_umap");
  },
};

export const Start: StoryObj<typeof WorkbenchStart> = {
  render: (args) => (
    <div className="glass flex h-[560px] rounded-xl">
      <WorkbenchStart {...args} />
    </div>
  ),
  args: { project: storyProject, notebooks, onCreate: fn() },
};

/** 导出: files first, then the optional module export with the marked ports. */
export const Export: StoryObj<typeof ExportMenu> = {
  render: (args) => (
    <div className="flex h-80 justify-end">
      <ExportMenu {...args} />
    </div>
  ),
  args: {
    doc: { name: "02 降维与聚类", description: "", kernel: "py311-pandas", language: "python", cells: [{ id: "c1", role: "code", source: "print(1)" }] },
    outputs: {},
    ports: { inputs: 1, outputs: 2 },
    onExportModule: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(within(canvasElement).getByRole("button", { name: /导出/ }));
    await expect(await body.findByRole("menuitem", { name: /Jupyter 笔记本/ })).toBeInTheDocument();
    await expect(body.getByText(/已标 1 个输入、2 个输出/)).toBeInTheDocument();
    await userEvent.click(body.getByRole("menuitem", { name: /导出为模块/ }));
    await expect(args.onExportModule).toHaveBeenCalled();
    // The a11y check runs after play; wait until the menu has closed and the page is no longer aria-hidden.
    await waitFor(() => expect(body.queryByRole("menu")).toBeNull());
  },
};

export const ExportDark: StoryObj<typeof ExportMenu> = { ...Export, globals: { theme: "dark" } };
