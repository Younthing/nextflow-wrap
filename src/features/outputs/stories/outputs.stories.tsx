import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";

import type { OutputRow } from "../outputs";
import { OutputsView } from "../components/outputs-page";

const row = (runId: string, path: string, size: number, workflowName = "单细胞质控与聚类"): OutputRow => ({
  runId,
  runName: runId === "r2" ? "tender_curie" : "bold_turing",
  workflowName,
  completedAt: "2026-01-02T12:00:00.000Z",
  path,
  name: path.split("/").at(-1)!,
  source: path.includes("/") ? path.split("/")[0] : "",
  size,
  preview: null,
});

const rows = [
  row("r2", "scanpy_qc/pbmc_qc.h5ad", 48_211_200),
  row("r2", "scanpy_qc/qc_report.html", 812_330),
  row("r2", "leiden/umap.png", 182_000),
  row("r1", "vina/poses.sdf", 2_400_000, "EGFR 分子对接"),
  row("r1", "summary.csv", 1_204, "EGFR 分子对接"),
];

const meta = {
  title: "Outputs/Page",
  component: OutputsView,
  args: { rows },
  decorators: [
    (Story) => (
      <div className="h-[560px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof OutputsView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ByRun: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("tender_curie", { exact: false })).toBeVisible();
    await userEvent.type(canvas.getByRole("textbox", { name: "搜索产物" }), "vina");
    await expect(canvas.queryByText("scanpy_qc/pbmc_qc.h5ad")).toBeNull();
    await expect(canvas.getByText("vina/poses.sdf")).toBeVisible();
  },
};

export const Empty: Story = { args: { rows: [] } };

export const Dark: Story = { globals: { theme: "dark" } };
