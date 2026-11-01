import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";

import type { CellOutput, NotebookCell } from "@/features/notebook/types";
import { NotebookCellCard } from "../components/notebook-cell";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const JPEG = "/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYwLjMxLjEwMgD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABMAAEBAAAAAAAAAAAAAAAAAAAABgEBAQAAAAAAAAAAAAAAAAAABgcQAQAAAAAAAAAAAAAAAAAAAAARAQAAAAAAAAAAAAAAAAAAAAD/wAARCAAIAAgDASIAAhEAAxEA/9oADAMBAAIRAxEAPwCLAFF/f//Z";
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="16"><rect width="48" height="16" fill="currentColor"/></svg>`;

const richOutputs: CellOutput[] = [
  { outputType: "stream", name: "stdout", text: "rows ready\n" },
  {
    outputType: "execute_result",
    data: {
      "text/html": "<table><thead><tr><th>sample</th><th>reads</th></tr></thead><tbody><tr><td>S1</td><td>10</td></tr></tbody></table><script>alert(1)</script>",
      "text/plain": "plain-frame",
      "image/png": PNG,
    },
  },
  { outputType: "display_data", data: { "image/png": PNG, "text/plain": "散点图" } },
  { outputType: "display_data", data: { "image/jpeg": JPEG, "text/plain": "照片" } },
  { outputType: "display_data", data: { "image/svg+xml": SVG, "text/plain": "色块" } },
  { outputType: "stream", name: "stderr", text: "warn\n" },
  { outputType: "error", traceback: "NameError: missing\n" },
];

const markdownSource = [
  "## 结果",
  "",
  "- 甲",
  "- 乙",
  "",
  "| 样本 | reads |",
  "| --- | ---: |",
  "| S1 | 10 |",
  "",
  `![点](data:image/png;base64,${PNG})`,
  "",
  "[站点](https://example.com)",
  "",
  "[坏](javascript:alert(1))",
].join("\n");

function card(cell: NotebookCell, output?: { id: string; stdout: string; outputs: CellOutput[]; error?: string }) {
  return (
    <NotebookCellCard
      cell={cell}
      index={0}
      selected
      running={false}
      readOnly={false}
      runDisabled={false}
      canDelete={false}
      output={output}
      onSelect={() => {}}
      onRun={() => {}}
      onChange={() => {}}
      onRole={() => {}}
      onDelete={() => {}}
    />
  );
}

function RichOutputs() {
  return (
    <div className="glass mx-auto w-[40rem] rounded-xl p-3">
      {card(
        { id: "c1", role: "code", source: "df\n" },
        { id: "c1", stdout: "rows ready\n", error: "NameError: missing\n", outputs: richOutputs },
      )}
    </div>
  );
}

function MarkdownTable() {
  const [source, setSource] = React.useState(markdownSource);
  return (
    <div className="glass mx-auto w-[40rem] rounded-xl p-3">
      <NotebookCellCard
        cell={{ id: "m1", role: "markdown", source }}
        index={0}
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
  title: "Notebook/Rich outputs",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const ImagesAndTable: Story = {
  render: () => <RichOutputs />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const table = canvas.getByRole("table");
    await expect(table).toHaveTextContent("S1");
    await expect(table).toHaveTextContent("reads");
    await expect(canvas.queryByText("plain-frame")).toBeNull();
    await expect(canvas.queryByText("alert(1)")).toBeNull();
    await expect(canvas.getByRole("img", { name: "散点图" })).toBeInTheDocument();
    await expect(canvas.getByRole("img", { name: "照片" })).toBeInTheDocument();
    await expect(canvas.getByRole("img", { name: "色块" })).toBeInTheDocument();
    await expect(canvas.getByText("rows ready")).toBeInTheDocument();
    await expect(canvas.getByText("warn")).toBeInTheDocument();
    const error = canvas.getByRole("alert");
    await expect(error).toHaveTextContent("NameError");
    await expect(error.className).toContain("text-destructive");
  },
};

export const MarkdownPreview: Story = {
  render: () => <MarkdownTable />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const preview = canvas.getByRole("region", { name: "单元格 1 说明预览" });
    await expect(within(preview).getByRole("heading", { name: "结果" })).toBeInTheDocument();
    await expect(within(preview).getByRole("list")).toHaveTextContent("甲");
    await expect(within(preview).getByRole("table")).toHaveTextContent("S1");
    await expect(within(preview).getByRole("img", { name: "点" })).toBeInTheDocument();
    await expect(within(preview).getByRole("link", { name: "站点" })).toHaveAttribute("href", "https://example.com");
    await expect(preview).not.toHaveTextContent("javascript:");

    await userEvent.click(within(preview).getByRole("heading", { name: "结果" }));
    const source = canvas.getByRole("textbox", { name: "单元格 1 源码" });
    await expect(source).toHaveValue(markdownSource);

    await userEvent.click(canvas.getByRole("button", { name: "预览单元格 1" }));
    await expect(canvas.getByRole("table")).toHaveTextContent("S1");
    await expect(canvas.queryByRole("textbox", { name: "单元格 1 源码" })).toBeNull();
  },
};
