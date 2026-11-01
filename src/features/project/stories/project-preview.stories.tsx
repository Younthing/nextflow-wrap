import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { demoScriptModules } from "@/features/notebook/seed";
import { REFERENCE_ID } from "@/features/workflow/builtins";
import { indexModules } from "@/features/workflow/catalog";
import { emptyWorkflow } from "@/features/workflow/document";
import type { WorkflowDoc } from "@/features/workflow/types";
import { CodeViewer } from "../components/code-viewer";
import { ProjectPreview } from "../components/project-preview";
import { generateProject } from "../generate";
import { defaultLaunchConfig, renderRunConfig } from "../launch";

const hello = demoScriptModules().find((def) => def.id === "script/hello_py/v2")!;
const workflow: WorkflowDoc = {
  ...emptyWorkflow("wf_story", "Hello"),
  params: { sheet: "data/samplesheet.csv", outdir: "results" },
  nodes: [
    { id: "sheet", position: { x: 0, y: 0 }, data: { moduleId: REFERENCE_ID, alias: "SHEET", widgets: {}, config: {}, settings: { param: "sheet", format: "other" } } },
    { id: "hello", position: { x: 320, y: 0 }, data: { moduleId: hello.id, alias: "HELLO", widgets: {}, config: { publish: true } } },
  ],
  edges: [{ id: "e1", source: "sheet", sourceHandle: "out:file", target: "hello", targetHandle: "in:samplesheet" }],
};
const project = generateProject(workflow, indexModules([hello]));
const file = (path: string) => project.files.find((f) => f.path === path)!;

const meta = {
  title: "Project/Generated project",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const FileBrowser: Story = {
  render: () => <ProjectPreview files={project.files} className="h-[640px]" />,
};

export const MainScript: Story = {
  render: () => <CodeViewer code={file("main.nf").content} language="groovy" className="h-[640px]" />,
};

export const LocalModule: Story = {
  render: () => <CodeViewer code={file(`modules/local/${hello.path}/main.nf`).content} language="groovy" className="h-[640px]" />,
};

export const GoogleBatchRunConfig: Story = {
  render: () => (
    <CodeViewer
      code={renderRunConfig({
        ...defaultLaunchConfig(),
        executor: "google-batch",
        workDir: "gs://my-bucket/work",
        settings: { project: "my-project", location: "us-central1", spot: true },
      })}
      language="groovy"
    />
  ),
};
