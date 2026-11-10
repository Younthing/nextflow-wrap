import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { http, HttpResponse } from "msw";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { storyProject } from "@/mocks/story-handlers";
import { LegacyImportNotice } from "../components/legacy-import-notice";

let imported = false;

const meta = {
  title: "Workspace/LegacyImportNotice",
  component: LegacyImportNotice,
  args: { projectId: storyProject.id },
  render: (args) => <div className="w-[720px]"><LegacyImportNotice {...args} /></div>,
  beforeEach: () => { imported = false; },
  parameters: {
    msw: [
      http.get("/api/projects/legacy", () => HttpResponse.json(imported ? null : { workflows: 3, modules: 2 })),
      http.post("/api/projects/legacy/import", () => {
        imported = true;
        return HttpResponse.json({ workflows: 2, modules: 2, skipped: ["流程 旧版 QC（格式已不兼容）"] });
      }),
    ],
  },
} satisfies Meta<typeof LegacyImportNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The old database still holds workflows and modules: one click copies them into the open project, then it hides. */
export const OfferAndImport: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText(/3 个流程、2 个已发布模块/)).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "导入到当前项目" }));
    await expect(await within(document.body).findAllByText(/已导入 2 个流程、2 个模块；跳过：流程 旧版 QC/)).not.toHaveLength(0);
    await waitFor(() => expect(canvas.queryByRole("button", { name: "导入到当前项目" })).not.toBeInTheDocument());
  },
};

/** Nothing left from before project folders: the start page shows nothing extra. */
export const NothingToImport: Story = {
  parameters: { msw: [http.get("/api/projects/legacy", () => HttpResponse.json(null))] },
  play: async ({ canvasElement }) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await expect(within(canvasElement).queryByRole("button", { name: "导入到当前项目" })).not.toBeInTheDocument();
  },
};
