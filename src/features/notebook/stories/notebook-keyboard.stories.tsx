import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";

import { dispatchNotebookKey, type NotebookSurface } from "@/features/notebook/edit";
import { COMMAND_HINT, EDIT_HINT, toNotebookKeyEvent, type NotebookMode } from "@/features/notebook/keyboard";
import type { CellOutputModel } from "@/features/notebook/outputs";
import type { NotebookCell, NotebookLanguage } from "@/features/notebook/types";
import { NotebookCellCard } from "../components/notebook-cell";

const initialCells: NotebookCell[] = [
  { id: "c1", role: "code", source: "print(1) # 计数\n" },
  { id: "c2", role: "code", source: "reads = 3\n" },
];

function KeyboardNotebook({
  language = "python",
  cells = initialCells,
}: {
  language?: NotebookLanguage;
  cells?: NotebookCell[];
}) {
  const [surface, setSurface] = React.useState<NotebookSurface>({
    cells,
    selectedId: "c1",
    mode: "command",
    deleteArmed: false,
  });
  const snap = React.useRef(surface);
  React.useEffect(() => {
    snap.current = surface;
  }, [surface]);
  const serial = React.useRef(0);
  const focusSerial = React.useRef(0);
  const [focus, setFocus] = React.useState<{ id: string; mode: NotebookMode; token: number } | null>(null);
  const [markdownEditId, setMarkdownEditId] = React.useState<string | null>(null);
  const [outputs, setOutputs] = React.useState<Record<string, CellOutputModel>>({});

  const commit = (cellId: string, origin: NotebookMode, event: Parameters<typeof toNotebookKeyEvent>[0]) => {
    const current = snap.current;
    const result = dispatchNotebookKey(
      current,
      cellId,
      origin,
      toNotebookKeyEvent(event),
      () => {
        serial.current += 1;
        return { id: `n${serial.current}`, role: "code", source: "" };
      },
      false,
    );
    snap.current = result.surface;
    setSurface(result.surface);
    if (result.focus) {
      focusSerial.current += 1;
      setFocus({ id: result.surface.selectedId, mode: result.surface.mode, token: focusSerial.current });
    }
    const target = result.surface.cells.find((cell) => cell.id === result.surface.selectedId);
    if (result.focus && result.surface.mode === "edit" && target?.role === "markdown") setMarkdownEditId(target.id);
    else if (result.surface.mode === "command") setMarkdownEditId(null);
    if (result.run) {
      setOutputs((prev) => ({ ...prev, [result.run!.cellId]: { stdout: `${result.run!.cellId} ok\n` } }));
    }
    return result.handled;
  };

  return (
    <div className="glass mx-auto grid w-[40rem] gap-3 rounded-xl p-3">
      <p className="text-xs text-muted-foreground">{surface.mode === "command" ? COMMAND_HINT : EDIT_HINT}</p>
      {surface.cells.map((cell, index) => (
        <NotebookCellCard
          key={cell.id}
          cell={cell}
          index={index}
          language={cell.role === "markdown" ? undefined : language}
          completionScope={surface.cells
            .slice(0, index)
            .filter((item) => item.role !== "markdown")
            .map((item) => item.source)
            .join("\n")}
          selected={surface.selectedId === cell.id}
          running={false}
          readOnly={false}
          runDisabled={false}
          canDelete={surface.cells.length > 1}
          output={outputs[cell.id]}
          deleteArmed={surface.deleteArmed}
          editFocusToken={focus?.id === cell.id && focus.mode === "edit" ? focus.token : 0}
          commandFocusToken={focus?.id === cell.id && focus.mode === "command" ? focus.token : 0}
          markdownOpen={markdownEditId === cell.id}
          onSelect={() => {
            const next = { ...snap.current, selectedId: cell.id, deleteArmed: false };
            snap.current = next;
            setSurface(next);
          }}
          onEnterEdit={() => {
            const next = { ...snap.current, mode: "edit" as const, deleteArmed: false };
            snap.current = next;
            setSurface(next);
          }}
          onEnterCommand={() => {
            const next = { ...snap.current, mode: "command" as const, deleteArmed: false };
            snap.current = next;
            setSurface(next);
            setMarkdownEditId(null);
          }}
          onEditKey={(event) => commit(cell.id, "edit", event)}
          onCommandKey={(event) => commit(cell.id, "command", event)}
          onRun={({ advance }) => {
            commit(cell.id, "edit", { key: "Enter", shiftKey: advance, ctrlKey: !advance });
          }}
          onChange={(source) => {
            const next = {
              ...snap.current,
              cells: snap.current.cells.map((item) => (item.id === cell.id ? { ...item, source } : item)),
            };
            snap.current = next;
            setSurface(next);
          }}
          onRole={() => {}}
          onDelete={() => {}}
        />
      ))}
    </div>
  );
}

function RSample() {
  const [source, setSource] = React.useState('if (TRUE) cat("hi") # 注\n');
  return (
    <div className="glass mx-auto w-[40rem] rounded-xl p-3">
      <NotebookCellCard
        cell={{ id: "r1", role: "code", source }}
        index={0}
        language="r"
        selected
        running={false}
        readOnly={false}
        runDisabled={false}
        canDelete={false}
        onSelect={() => {}}
        onRun={() => {}}
        onChange={setSource}
        onRole={() => {}}
        onDelete={() => {}}
      />
    </div>
  );
}

const meta = {
  title: "Notebook/Keyboard",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const JupyterKeys: Story = {
  render: () => <KeyboardNotebook />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const highlight = canvas.getByTestId("cell-highlight-c1");
    await expect(highlight.querySelector(".tok-key")).toHaveTextContent("print");
    await expect(highlight.querySelector(".tok-number")).toHaveTextContent("1");
    await expect(highlight.querySelector(".tok-comment")).toHaveTextContent("计数");

    await userEvent.click(canvas.getByRole("button", { name: "单元格 1 命令模式" }));
    await userEvent.keyboard("b");
    await expect(canvas.getAllByRole("article")).toHaveLength(3);
    await expect(canvas.getByRole("button", { name: "单元格 2 命令模式" })).toHaveFocus();

    await userEvent.keyboard("dd");
    await expect(canvas.getAllByRole("article")).toHaveLength(2);
    await expect(canvas.queryByText("再按 D 删除")).toBeNull();

    const first = canvas.getByRole("article", { name: "单元格 1" });
    const source = within(first).getByRole("textbox", { name: "单元格 1 源码" });
    await userEvent.click(source);
    await expect(canvas.getByText(EDIT_HINT)).toBeInTheDocument();
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    await expect(within(first).getByText("c1 ok")).toBeInTheDocument();
    await expect(first).toHaveAttribute("data-selected", "true");
    await expect(canvas.getByText(COMMAND_HINT)).toBeInTheDocument();

    await userEvent.click(source);
    await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
    const second = canvas.getByRole("article", { name: "单元格 2" });
    await expect(second).toHaveAttribute("data-selected", "true");
    await expect(first).toHaveAttribute("data-selected", "false");

    await userEvent.keyboard("m");
    await expect(within(second).getAllByText("说明").length).toBeGreaterThan(0);
    await userEvent.keyboard("y");
    await expect(within(second).getAllByText("代码").length).toBeGreaterThan(0);
    await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
    await expect(canvas.getAllByRole("article")).toHaveLength(3);
    await expect(within(second).getByText("c2 ok")).toBeInTheDocument();

    await userEvent.click(canvas.getByRole("button", { name: "单元格 1 命令模式" }));
    await userEvent.keyboard("a");
    await expect(canvas.getAllByRole("article")).toHaveLength(4);
    await expect(canvas.getByRole("article", { name: "单元格 1" })).toHaveAttribute("data-selected", "true");
  },
};

export const Completion: Story = {
  render: () => (
    <KeyboardNotebook
      cells={[
        { id: "c1", role: "code", source: "reads = 3\n" },
        { id: "c2", role: "code", source: "" },
      ]}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const source = canvas.getByRole("textbox", { name: "单元格 2 源码" });
    await userEvent.click(source);
    await userEvent.keyboard("pri");
    await userEvent.keyboard("{Control>} {/Control}");
    const list = canvas.getByRole("listbox", { name: "补全" });
    await expect(within(list).getByRole("option", { name: "print" })).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Enter}");
    await expect(source).toHaveValue("print");
    await expect(canvas.queryByRole("listbox", { name: "补全" })).toBeNull();

    await userEvent.clear(source);
    await userEvent.keyboard("rea");
    await userEvent.keyboard("{Control>} {/Control}");
    const again = canvas.getByRole("listbox", { name: "补全" });
    await expect(within(again).getByRole("option", { name: "reads" })).toBeInTheDocument();
  },
};

export const RHighlight: Story = {
  render: () => <RSample />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const highlight = canvas.getByTestId("cell-highlight-r1");
    await expect(highlight.querySelector(".tok-keyword")).toHaveTextContent("if");
    await expect(highlight.querySelectorAll(".tok-keyword")[1]).toHaveTextContent("TRUE");
    await expect(highlight.querySelector(".tok-key")).toHaveTextContent("cat");
    await expect(highlight.querySelector(".tok-string")).toHaveTextContent("hi");
    await expect(highlight.querySelector(".tok-comment")).toHaveTextContent("注");
    await expect(canvas.getByRole("textbox", { name: "单元格 1 源码" })).toHaveValue('if (TRUE) cat("hi") # 注\n');
  },
};
