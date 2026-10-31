import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within, waitFor } from "storybook/test";
import { useEditorCommands } from "../use-editor-commands";
import { EditorFixture } from "./fixtures";
import { Inspector } from "../components/inspector";
import { EditorToolbar } from "../components/editor-toolbar";
import { emptyWorkflow } from "@/features/workflow/document";
const meta = { title: "Editor/Composition" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const InspectorPanel: Story = {
  render: () => (
    <EditorFixture>
      <Inspector className="h-[640px] w-80" />
    </EditorFixture>
  ),
};
export const Toolbar: Story = {
  render: () => (
    <EditorFixture>
      <EditorToolbar saving={false} onFit={() => {}} onRun={() => {}} />
    </EditorFixture>
  ),
};
function CommandToolbar() {
  useEditorCommands({
    save: () => {},
    openNodeSearch: () => {},
    fitView: () => {},
  });
  return <EditorToolbar saving={false} onFit={() => {}} onRun={() => {}} />;
}

export const IndependentEditors: Story = {
  render: () => (
    <div className="grid gap-8">
      {["First", "Second"].map((name) => (
        <div key={name} aria-label={name} role="region" tabIndex={0}>
          <EditorFixture doc={emptyWorkflow(name, name)}>
            <CommandToolbar />
          </EditorFixture>
        </div>
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const first = within(
      canvas.getByRole("region", { name: "First" }),
    ).getByRole("textbox");
    const second = within(
      canvas.getByRole("region", { name: "Second" }),
    ).getByRole("textbox");
    await userEvent.clear(first);
    await userEvent.type(first, "Changed");
    await expect(second).toHaveValue("Second");
    await userEvent.click(canvas.getByRole("region", { name: "First" }));
    await userEvent.keyboard("{Control>}z{/Control}");
    await waitFor(() => expect(first).toHaveValue("First"));
    await expect(second).toHaveValue("Second");
  },
};
