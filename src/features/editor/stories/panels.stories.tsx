import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";

import { buildParamsSchema } from "@/features/project/schema";
import { SAMPLESHEET_ID } from "@/features/workflow/builtins";
import type { PortDef } from "@/features/workflow/types";
import { ModuleLibrary } from "../components/module-library";
import { NodeSearchDialog } from "../components/node-search-dialog";
import { SchemaForm } from "../components/schema-form";
import { storyCatalog, storyModules } from "./fixtures";

const meta = {
  title: "Editor/Panels",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Library: Story = {
  render: () => (
    <ModuleLibrary
      modules={storyModules}
      syncedAt={storyCatalog.syncedAt}
      onAdd={fn()}
      className="h-[600px] w-64"
    />
  ),
};

export const PipelineParams: Story = {
  render: () => (
    <div className="glass w-96 rounded-xl p-4">
      <SchemaForm
        schema={buildParamsSchema("studio/rnaseq", "RNA-seq", [
          { name: "fasta", format: "fasta", nodeAlias: "REFERENCE" },
          { name: "gtf", format: "gtf", nodeAlias: "REFERENCE_2" },
        ])}
        values={{ input: "assets/samplesheet.csv", outdir: "results" }}
        onChange={fn()}
      />
    </div>
  ),
};

export const NodeSearch: Story = {
  render: () => (
    <NodeSearchDialog
      request={{ position: { x: 0, y: 0 } }}
      modules={storyModules}
      onPick={fn()}
      onClose={fn()}
    />
  ),
};

const samplesheet = storyModules.find((m) => m.id === SAMPLESHEET_ID)!;
const sortedBam = storyModules
  .find((module) => module.id === "nf-core/samtools/sort")!
  .outputs.find((port) => port.name === "bam")!;

export const NodeSearchFromPort: Story = {
  name: "Node search (from a dropped link)",
  render: () => (
    <NodeSearchDialog
      request={{
        position: { x: 0, y: 0 },
        from: { nodeId: "input", port: samplesheet.outputs[0], side: "source" },
      }}
      modules={storyModules}
      onPick={fn()}
      onClose={fn()}
    />
  ),
};

export const NodeSearchFromBam: Story = {
  name: "Node search (from a BAM output)",
  render: () => (
    <NodeSearchDialog
      request={{
        position: { x: 0, y: 0 },
        from: { nodeId: "sort", port: sortedBam, side: "source" },
      }}
      modules={storyModules}
      onPick={fn()}
      onClose={fn()}
    />
  ),
};

const countPort: PortDef = {
  name: "count",
  description: "",
  elements: [{ name: "count", type: "integer", kind: "value", description: "A count" }],
};

export const NodeSearchNoCompatible: Story = {
  name: "Node search (nothing can connect)",
  render: () => (
    <NodeSearchDialog
      request={{
        position: { x: 0, y: 0 },
        from: { nodeId: "count", port: countPort, side: "source" },
      }}
      modules={storyModules}
      onPick={fn()}
      onClose={fn()}
    />
  ),
};
