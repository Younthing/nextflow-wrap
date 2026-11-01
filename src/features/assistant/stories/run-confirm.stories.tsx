import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Button } from "@/components/ui/button";
import { defaultLaunchConfig } from "@/features/project/launch";
import { demoWorkflow } from "@/features/workflow/demo";
import { RunConfirmDialog } from "../run-confirm";
import { cancelConfirmView, resumeConfirmView, startConfirmView, type RunConfirmView, type StartRunPlan } from "../run-actions";

const workflow = demoWorkflow("wf_story");
const readyPlan: StartRunPlan = {
  launch: defaultLaunchConfig(),
  command: "nextflow run . \\\n    -profile docker \\\n    -c run.config",
  runConfig: "workDir = 'work'\n",
  profile: "docker",
  problems: [],
  workflow,
  request: null,
};

const views = {
  start: startConfirmView(readyPlan, "单细胞流程已经连好了。"),
  stop: cancelConfirmView("tender_curie", []),
  resume: resumeConfirmView("tender_curie", []),
  blocked: startConfirmView({ ...readyPlan, problems: ["请先保存流程（Ctrl+S）", "SCANPY_QC：主输入 adata 未连接"], request: null }),
} satisfies Record<string, RunConfirmView>;

function Demo({ view }: { view: RunConfirmView }) {
  const [open, setOpen] = useState(true);
  const [choice, setChoice] = useState("等待选择");
  return (
    <div className="grid gap-3 p-6 text-sm">
      <p>{choice}</p>
      <Button variant="outline" onClick={() => { setChoice("等待选择"); setOpen(true); }}>再次打开</Button>
      <RunConfirmDialog
        open={open}
        view={view}
        busy={false}
        onConfirm={() => { setChoice("已确认，才会执行"); setOpen(false); }}
        onDismiss={() => { setChoice("已取消，不会执行"); setOpen(false); }}
      />
    </div>
  );
}

const meta = { title: "Assistant/Run confirm" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Start: Story = { render: () => <Demo view={views.start} /> };
export const Stop: Story = { render: () => <Demo view={views.stop} /> };
export const Resume: Story = { render: () => <Demo view={views.resume} /> };
export const Blocked: Story = { render: () => <Demo view={views.blocked} /> };
