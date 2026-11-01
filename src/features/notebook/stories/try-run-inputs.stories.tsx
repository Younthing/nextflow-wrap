import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { TryRunBindingTable, TryRunInputs } from "../components/try-run-inputs";
import { defaultInputDraft, type InputDraft } from "../input-bindings";
import type { MarkerInput, TryRunInputBinding } from "../types";

const inputs: MarkerInput[] = [
  { name: "fastq_zip", type: "path[]", required: true },
  { name: "samplesheet", type: "path", required: true },
  { name: "title", type: "str", required: false, defaultValue: "S1" },
  { name: "min_q", type: "int", required: false, defaultValue: "30" },
];

const receipt: TryRunInputBinding[] = [
  { port: "fastq_zip", source: "sample", label: "内置样例：2 个 FastQC zip" },
  { port: "samplesheet", source: "upload", label: "sheet.csv" },
  { port: "title", source: "path", label: "S1" },
];

function Demo() {
  const [drafts, setDrafts] = React.useState<Record<string, InputDraft>>(() =>
    Object.fromEntries(inputs.map((input) => [input.name, defaultInputDraft(input)])),
  );
  return (
    <div className="glass grid w-full max-w-md gap-4 rounded-xl p-4">
      <TryRunInputs
        inputs={inputs}
        drafts={drafts}
        onChange={(port, draft) => setDrafts((current) => ({ ...current, [port]: draft }))}
      />
      <TryRunBindingTable bindings={receipt} />
    </div>
  );
}

const meta = {
  title: "Notebook/Try-run inputs",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const PerPort: Story = {
  render: () => <Demo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const fastq = within(canvas.getByRole("group", { name: "fastq_zip" }));
    const sheet = within(canvas.getByRole("group", { name: "samplesheet" }));
    const title = within(canvas.getByRole("group", { name: "title" }));

    await expect(fastq.getByRole("radio", { name: "样例" })).toBeChecked();
    await expect(fastq.getByRole("status")).toHaveTextContent("输入 fastq_zip · 样例 · 内置样例：2 个 FastQC zip");
    await expect(sheet.getByRole("status")).toHaveTextContent("内置样例：samplesheet.csv");

    await userEvent.click(fastq.getByRole("radio", { name: "路径" }));
    const path = fastq.getByLabelText("fastq_zip 路径");
    await userEvent.clear(path);
    await userEvent.type(path, "/data/S1.zip,/data/S2.zip");
    await expect(fastq.getByRole("status")).toHaveTextContent("输入 fastq_zip · 路径 · /data/S1.zip,/data/S2.zip");

    await userEvent.click(fastq.getByRole("radio", { name: "上传" }));
    await userEvent.upload(fastq.getByLabelText("上传 fastq_zip"), [
      new File(["s1"], "S1_fastq.zip", { type: "application/zip" }),
      new File(["s2"], "S2_fastq.zip", { type: "application/zip" }),
    ]);
    await waitFor(() => expect(fastq.getByRole("status")).toHaveTextContent("S1_fastq.zip, S2_fastq.zip"));

    await userEvent.click(fastq.getByRole("radio", { name: "样例" }));
    await expect(fastq.getByRole("status")).toHaveTextContent("样例");

    await expect(title.getByRole("radio", { name: "上传" })).toBeDisabled();
    await expect(title.getByRole("radio", { name: "样例" })).toBeDisabled();
    await expect(title.getByLabelText("title 路径")).toHaveValue("S1");
    await expect(title.getByRole("status")).toHaveTextContent("输入 title · 路径 · S1");

    await expect(canvas.getByRole("columnheader", { name: "来源" })).toBeInTheDocument();
    await expect(canvas.getByRole("cell", { name: "sheet.csv" })).toBeInTheDocument();
    await expect(canvas.getByRole("row", { name: /samplesheet/ })).toHaveTextContent("上传");
  },
};
