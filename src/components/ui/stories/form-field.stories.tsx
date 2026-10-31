import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { FormField } from "../form-field";
import { Input } from "../input";

const meta = {
  title: "UI/FormField",
  component: FormField,
  args: { label: "工作目录", children: null },
} satisfies Meta<typeof FormField>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <FormField
      label="工作目录"
      htmlFor="field-example"
      hint="Nextflow 中间文件目录"
    >
      <Input id="field-example" defaultValue="work" />
    </FormField>
  ),
};
