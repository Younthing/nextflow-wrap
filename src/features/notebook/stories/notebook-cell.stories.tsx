import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";

import { nextCellId } from "@/features/notebook/cells";
import type { NotebookCell } from "@/features/notebook/types";
import { NotebookCellCard } from "../components/notebook-cell";

const cells: NotebookCell[] = [
  { id: "c1", role: "code", source: "print('one')\n" },
  { id: "c2", role: "code", source: "print('two')\n" },
  { id: "c3", role: "markdown", source: "说明单元格不执行。\n" },
];

function CellStack({ initialSelected = "c1" }: { initialSelected?: string }) {
  const [selected, setSelected] = React.useState(initialSelected);
  const [sources, setSources] = React.useState(() => Object.fromEntries(cells.map((cell) => [cell.id, cell.source])));
  const [outputs, setOutputs] = React.useState<Record<string, { stdout: string; error?: string }>>({});

  return (
    <div className="glass mx-auto grid w-[40rem] gap-3 rounded-xl p-3">
      {cells.map((cell, index) => (
        <NotebookCellCard
          key={cell.id}
          cell={{ ...cell, source: sources[cell.id] ?? "" }}
          index={index}
          selected={selected === cell.id}
          running={false}
          readOnly={false}
          runDisabled={false}
          canDelete={false}
          output={outputs[cell.id]}
          onSelect={() => setSelected(cell.id)}
          onRun={({ advance }) => {
            setOutputs((current) => ({ ...current, [cell.id]: { stdout: `${cell.id} ok\n` } }));
            setSelected(advance ? nextCellId(cells, cell.id) ?? cell.id : cell.id);
          }}
          onChange={(source) => setSources((current) => ({ ...current, [cell.id]: source }))}
          onRole={() => {}}
          onDelete={() => {}}
        />
      ))}
    </div>
  );
}

const meta = {
  title: "Notebook/Cells",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const RunAndSelect: Story = {
  render: () => <CellStack />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const first = canvas.getByRole("article", { name: "单元格 1" });
    const second = canvas.getByRole("article", { name: "单元格 2" });
    const note = canvas.getByRole("article", { name: "单元格 3" });

    await expect(first).toHaveAttribute("data-selected", "true");
    await expect(second).toHaveAttribute("data-selected", "false");
    await expect(within(note).queryByRole("button", { name: /运行单元格 3/ })).toBeNull();

    await userEvent.click(second);
    await expect(second).toHaveAttribute("data-selected", "true");
    await expect(first).toHaveAttribute("data-selected", "false");

    await userEvent.click(within(second).getByRole("button", { name: "运行单元格 2" }));
    await expect(within(second).getByText("c2 ok")).toBeInTheDocument();
    await expect(second).toHaveAttribute("data-selected", "true");

    const source = within(first).getByRole("textbox", { name: "单元格 1 源码" });
    await userEvent.click(source);
    await expect(first).toHaveAttribute("data-selected", "true");
    await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
    await expect(within(first).getByText("c1 ok")).toBeInTheDocument();
    await expect(second).toHaveAttribute("data-selected", "true");
    await expect(source).toHaveValue("print('one')\n");
  },
};

export const Selected: Story = {
  render: () => <CellStack initialSelected="c2" />,
};
