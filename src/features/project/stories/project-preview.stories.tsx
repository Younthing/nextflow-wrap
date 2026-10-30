import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import catalog from "@/data/nf-core-modules.json";
import { indexModules } from "@/features/workflow/catalog";
import { demoRnaseqWorkflow } from "@/features/workflow/demo";
import type { ModuleCatalog } from "@/features/workflow/types";
import { CodeViewer } from "../components/code-viewer";
import { ProjectPreview } from "../components/project-preview";
import { generateProject } from "../generate";
import { defaultLaunchConfig, renderRunConfig } from "../launch";

const typed = catalog as ModuleCatalog;
const project = generateProject(demoRnaseqWorkflow("wf_story"), indexModules(typed.modules), { modulesSha: typed.gitSha });
const file = (path: string) => project.files.find((f) => f.path === path)!;

const meta = {
  title: "Project/Generated project",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const FileBrowser: Story = {
  render: () => <ProjectPreview files={project.files} components={project.components} className="h-[640px]" />,
};

export const WorkflowScript: Story = {
  render: () => <CodeViewer code={file("workflows/rnaseq.nf").content} language="groovy" className="h-[640px]" />,
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
