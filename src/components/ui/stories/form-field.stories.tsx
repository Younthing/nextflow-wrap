import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { HelpCircle } from "lucide-react";
import { FormField } from "../form-field";
import { Input } from "../input";
import { Label } from "../label";
import { Tooltip, TooltipContent, TooltipTrigger } from "../tooltip";

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

export const CustomLabel: Story = {
  render: () => (
    <FormField
      label={
        <div className="flex items-center gap-1">
          <Label htmlFor="field-custom" className="font-mono text-xs">
            --genome
            <span className="text-destructive">*</span>
          </Label>
          <Tooltip>
            <TooltipTrigger asChild>
              <HelpCircle className="size-3.5 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent className="max-w-sm">参考基因组 FASTA</TooltipContent>
          </Tooltip>
        </div>
      }
      hint="参考基因组文件路径"
    >
      <Input id="field-custom" defaultValue="genome.fa" className="h-8 font-mono text-xs" />
    </FormField>
  ),
};
