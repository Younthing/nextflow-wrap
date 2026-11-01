import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { http, HttpResponse, delay } from "msw";
import { expect, userEvent, within } from "storybook/test";

import { SAMPLE_PDF, SAMPLE_SVG } from "@/features/output/samples";
import { storyRun } from "@/mocks/story-handlers";
import { RunsTable } from "../components/runs-table";
import { RunDetailView } from "../components/run-detail";

const previewFiles = [
  { path: "bam/S1.bam", size: 10, preview: null },
  { path: "qc/notes.md", size: 24, preview: "markdown" },
  { path: "qc/plot.svg", size: 80, preview: "svg" },
  { path: "qc/reads.csv", size: 32, preview: "csv" },
  { path: "report/summary.html", size: 90, preview: "html" },
  { path: "report/summary.pdf", size: 40, preview: "pdf" },
];

function resultHandlers(files: typeof previewFiles) {
  return [
    http.get("/api/runs/:id/results", () => HttpResponse.json(files)),
    http.get("/api/runs/:id/results/content", ({ request }) => {
      const path = new URL(request.url).searchParams.get("path") ?? "";
      if (path.endsWith(".md")) return new HttpResponse("# 备注\n\n完成\n", { headers: { "content-type": "text/markdown; charset=utf-8" } });
      if (path.endsWith(".csv")) return new HttpResponse("sample,reads\nS1,10\n", { headers: { "content-type": "text/csv; charset=utf-8" } });
      if (path.endsWith(".svg")) return new HttpResponse(SAMPLE_SVG, { headers: { "content-type": "image/svg+xml" } });
      if (path.endsWith(".html")) {
        return new HttpResponse("<!doctype html><html><body><h1>MultiQC</h1><p>S1</p></body></html>", {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      if (path.endsWith(".pdf")) {
        const bytes = Uint8Array.from(atob(SAMPLE_PDF), (char) => char.charCodeAt(0));
        return new HttpResponse(bytes, { headers: { "content-type": "application/pdf" } });
      }
      return HttpResponse.json({ message: "文件不存在或无法预览" }, { status: 404 });
    }),
  ];
}

const params = Promise.resolve({ id: "run_story" });
const meta = {
  title: "Runs/Pages",
  decorators: [
    (Story) => (
      <div className="h-[720px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const List: Story = { render: () => <RunsTable /> };
export const Empty: Story = {
  ...List,
  parameters: { msw: [http.get("/api/runs", () => HttpResponse.json([]))] },
};
export const Loading: Story = {
  ...List,
  parameters: {
    msw: [
      http.get("/api/runs", async () => {
        await delay("infinite");
        return HttpResponse.json([]);
      }),
    ],
  },
};
export const Error: Story = {
  ...List,
  parameters: {
    msw: [
      http.get("/api/runs", () =>
        HttpResponse.json({ message: "加载失败" }, { status: 500 }),
      ),
    ],
  },
};
export const Detail: Story = {
  render: () => <RunDetailView params={params} />,
};
export const Failed: Story = {
  ...Detail,
  parameters: {
    msw: [
      http.get("/api/runs/:id", () =>
        HttpResponse.json({
          ...storyRun,
          status: "failed",
          errorMessage: "Process FASTQC exited with code 1",
        }),
      ),
    ],
  },
};
export const Results: Story = {
  ...Detail,
  parameters: { msw: resultHandlers(previewFiles) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByText("任务 3/3 完成")).resolves.toBeInTheDocument();
    await expect(canvas.findByText("预览")).resolves.toBeInTheDocument();
    expect(canvas.getByText(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/)).toBeInTheDocument();
    expect(canvas.getByText(/^(GMT|UTC)/)).toBeInTheDocument();

    await userEvent.click(await canvas.findByRole("tab", { name: "结果" }));
    await expect(canvas.findByRole("heading", { name: "备注" })).resolves.toBeInTheDocument();
    expect(canvas.getByText(/results\/qc\/notes\.md/)).toBeInTheDocument();
    expect(canvas.queryByText("无法在浏览器里预览")).toBeNull();

    await userEvent.click(canvas.getByRole("button", { name: /reads\.csv/ }));
    await expect(canvas.findByRole("cell", { name: "S1" })).resolves.toBeInTheDocument();

    await userEvent.click(canvas.getByRole("button", { name: /plot\.svg/ }));
    await expect(canvas.findByRole("img", { name: "qc/plot.svg" })).resolves.toBeInTheDocument();

    await userEvent.click(canvas.getByRole("button", { name: /summary\.html/ }));
    const report = await canvas.findByTitle("report/summary.html");
    expect(report).toHaveAttribute("srcdoc", expect.stringContaining("S1"));

    await userEvent.click(canvas.getByRole("button", { name: /summary\.pdf/ }));
    await expect(canvas.findByTitle("report/summary.pdf")).resolves.toBeInTheDocument();
  },
};
export const ResultsDirectory: Story = {
  ...Detail,
  parameters: {
    msw: resultHandlers([{ path: "bam/S1.bam", size: 10, preview: null }]),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("tab", { name: "结果" }));
    await expect(canvas.findByText("这个目录里还没有可预览的文件")).resolves.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: /S1\.bam/ }));
    await expect(canvas.findByText(/无法在浏览器里预览/)).resolves.toBeInTheDocument();
  },
};
export const Missing: Story = {
  ...Detail,
  parameters: {
    msw: [
      http.get("/api/runs/:id", () =>
        HttpResponse.json({ message: "不存在" }, { status: 404 }),
      ),
    ],
  },
};
