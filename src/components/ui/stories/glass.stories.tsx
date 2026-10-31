import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Badge } from "../badge";
import { Button } from "../button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../card";
import { Input } from "../input";
import { Label } from "../label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../select";
import { Switch } from "../switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../tabs";

const meta = {
  title: "UI/Glass surfaces",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const ParameterCard: Story = {
  render: () => (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>FASTQC</CardTitle>
        <CardDescription>对原始测序 reads 做质量控制</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="outdir">输出目录</Label>
          <Input id="outdir" defaultValue="results/" className="font-mono" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="example-engine">执行环境</Label>
          <Select defaultValue="docker">
            <SelectTrigger id="example-engine">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="local">本机</SelectItem>
              <SelectItem value="docker">Docker</SelectItem>
              <SelectItem value="google-batch">Google Batch</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="resume" defaultChecked />
          <Label htmlFor="resume">断点续跑（-resume）</Label>
        </div>
      </CardContent>
      <CardFooter className="justify-between">
        <div className="flex gap-1.5">
          <Badge variant="success">成功</Badge>
          <Badge variant="warning">运行中</Badge>
          <Badge variant="destructive">失败</Badge>
        </div>
        <Button size="sm">保存</Button>
      </CardFooter>
    </Card>
  ),
};

export const TabsPanel: Story = {
  render: () => (
    <Tabs defaultValue="params" className="glass max-w-md rounded-xl p-4">
      <TabsList>
        <TabsTrigger value="params">参数</TabsTrigger>
        <TabsTrigger value="code">代码</TabsTrigger>
        <TabsTrigger value="logs">日志</TabsTrigger>
      </TabsList>
      <TabsContent value="params" className="text-sm">
        参数面板
      </TabsContent>
      <TabsContent value="code" className="font-mono text-sm">
        workflow &#123; &#125;
      </TabsContent>
      <TabsContent value="logs" className="font-mono text-sm">
        [a1/b2c3] FASTQC (1) ✔
      </TabsContent>
    </Tabs>
  ),
};

export const Typography: Story = {
  render: () => (
    <div className="glass grid max-w-xl gap-3 rounded-xl p-6">
      <p className="font-serif text-2xl font-semibold">思源宋体 · 流程标题</p>
      <p className="font-sans">思源黑体 · 正文用于界面和说明文字。</p>
      <p className="font-mono text-sm">
        nextflow run main.nf -profile docker -resume
      </p>
    </div>
  ),
};
