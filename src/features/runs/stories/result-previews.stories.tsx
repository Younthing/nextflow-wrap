import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import { sampleAnnDataSummary } from "../anndata";
import { AnnDataSummaryView } from "../components/anndata-summary";
import { MoleculeViewer } from "../components/molecule-viewer";
import { SAMPLE_PDB, SAMPLE_PDBQT } from "../molecule-samples";

const meta = {
  title: "Runs/ResultPreviews",
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <div className="flex h-[560px] flex-col p-4"><Story /></div>],
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const AnnData: Story = {
  render: () => <AnnDataSummaryView summary={sampleAnnDataSummary()} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("2,638")).toBeInTheDocument();
    await expect(canvas.getByText("X_umap 2638 × 2")).toBeInTheDocument();
    await expect(canvas.getByText("leiden")).toBeInTheDocument();
  },
};

export const AnnDataBeforeClustering: Story = {
  render: () => <AnnDataSummaryView summary={sampleAnnDataSummary("qc/filtered.h5ad")} />,
};

export const DockedPose: Story = {
  render: () => <MoleculeViewer path="dock/ligand_out.pdbqt" text={SAMPLE_PDBQT} />,
};

export const Peptide: Story = {
  render: () => <MoleculeViewer path="prep/receptor.pdb" text={SAMPLE_PDB} />,
};
