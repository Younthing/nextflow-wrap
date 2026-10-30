"use client";

import * as React from "react";
import { ExternalLink, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { REFERENCE_FORMATS, REFERENCE_ID, SAMPLESHEET_ID } from "@/features/workflow/builtins";
import { resolveNodeDef } from "@/features/workflow/catalog";
import { portSignature, socketInputs } from "@/features/workflow/ports";
import { projectMeta } from "@/features/project/generate";
import { buildParamsSchema, referenceParams } from "@/features/project/schema";
import samplesheetSchema from "@/data/samplesheet-schema.json";
import type { ModuleDef, PortDef } from "@/features/workflow/types";
import { cn } from "@/lib/utils";
import { categoryColor, portColor } from "../port-style";
import { selectSelectedNode, useEditorStore, type FlowNode } from "../store";
import { SchemaForm } from "./schema-form";

const LABELS = [
  "process_single",
  "process_low",
  "process_medium",
  "process_high",
  "process_long",
  "process_high_memory",
];

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("grid gap-3", className)}>
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function PortList({ ports, title }: { ports: PortDef[]; title: string }) {
  if (ports.length === 0) return null;
  return (
    <Section title={title}>
      <ul className="grid gap-1.5">
        {ports.map((p) => (
          <li key={p.name} className="flex items-start gap-2 text-xs">
            <span className="mt-1 size-2 shrink-0 rounded-full" style={{ background: portColor(p) }} />
            <div className="min-w-0">
              <span className="font-mono font-medium">{p.name}</span>{" "}
              <span className="font-mono text-muted-foreground">[{portSignature(p)}]</span>
              {p.description && <p className="line-clamp-2 text-muted-foreground">{p.description}</p>}
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function BuiltinSettings({ node, def }: { node: FlowNode; def: ModuleDef }) {
  const update = useEditorStore((s) => s.updateNodeData);
  const params = useEditorStore((s) => s.params);
  const setParam = useEditorStore((s) => s.setParam);
  const settings = node.data.settings ?? {};

  if (def.id === SAMPLESHEET_ID) {
    const columns = Object.entries(samplesheetSchema.items.properties);
    const required = new Set(samplesheetSchema.items.required);
    return (
      <Section title="样本表">
        <div className="grid gap-1.5">
          <Label htmlFor="samplesheet-path" className="font-mono text-xs">--input</Label>
          <Input
            id="samplesheet-path"
            value={String(params.input ?? "")}
            onChange={(e) => setParam("input", e.target.value)}
            className="h-8 font-mono text-xs"
          />
        </div>
        <div className="text-xs text-muted-foreground">CSV 列（assets/schema_input.json）：</div>
        <div className="flex flex-wrap gap-1.5">
          {columns.map(([name]) => (
            <Badge key={name} variant={required.has(name) ? "default" : "secondary"} className="font-mono">
              {name}
            </Badge>
          ))}
        </div>
      </Section>
    );
  }

  if (def.id === REFERENCE_ID) {
    const param = String(settings.param ?? "");
    return (
      <Section title="参考文件">
        <div className="grid gap-1.5">
          <Label htmlFor="ref-param" className="text-xs">参数名</Label>
          <Input
            id="ref-param"
            value={param}
            onChange={(e) =>
              update(node.id, { settings: { ...settings, param: e.target.value.trim() } }, `ref:${node.id}:param`)
            }
            className="h-8 font-mono text-xs"
          />
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs">文件格式</Label>
          <Select
            value={String(settings.format ?? "other")}
            onValueChange={(format) => update(node.id, { settings: { ...settings, format } })}
          >
            <SelectTrigger size="sm" className="text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REFERENCE_FORMATS.map((f) => (
                <SelectItem key={f} value={f} className="font-mono text-xs">
                  {f}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {param && (
          <div className="grid gap-1.5">
            <Label htmlFor="ref-value" className="font-mono text-xs">--{param}</Label>
            <Input
              id="ref-value"
              value={String(params[param] ?? "")}
              placeholder="路径或 URL，如 s3://…/genome.fa"
              onChange={(e) => setParam(param, e.target.value)}
              className="h-8 font-mono text-xs"
            />
          </div>
        )}
      </Section>
    );
  }
  return null;
}

function NodeInspector({ node }: { node: FlowNode }) {
  const index = useEditorStore((s) => s.index);
  const update = useEditorStore((s) => s.updateNodeData);
  const removeNodes = useEditorStore((s) => s.removeNodes);
  const def = resolveNodeDef(index, node.data);
  if (!def) return <div className="p-4 text-sm text-destructive">未知模块 {node.data.moduleId}</div>;

  const { config } = node.data;
  const setConfig = (patch: Partial<typeof config>, key: string) =>
    update(node.id, { config: { ...config, ...patch } }, `config:${node.id}:${key}`);

  return (
    <div className="grid gap-6 p-4">
      <div className="grid gap-2">
        <div className="flex items-center gap-2">
          <span className="size-2.5 rounded-full" style={{ background: categoryColor(def.category) }} />
          <span className="text-xs text-muted-foreground">{def.category}</span>
          {!def.builtin && (
            <a
              href={`https://nf-co.re/modules/${def.path.replace("/", "_")}`}
              target="_blank"
              rel="noreferrer"
              className="ml-auto flex items-center gap-1 text-xs text-primary hover:underline"
            >
              nf-core 文档 <ExternalLink className="size-3" />
            </a>
          )}
        </div>
        <div className="font-serif text-lg font-semibold">{def.builtin ? def.name : def.process}</div>
        <p className="text-sm text-muted-foreground">{def.description}</p>
        {def.tools.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {def.tools.map((t) =>
              t.homepage ? (
                <Badge key={t.name} variant="outline" asChild>
                  <a href={t.homepage} target="_blank" rel="noreferrer">
                    {t.name}
                  </a>
                </Badge>
              ) : (
                <Badge key={t.name} variant="outline">
                  {t.name}
                </Badge>
              ),
            )}
          </div>
        )}
      </div>

      <Section title="节点">
        <div className="grid gap-1.5">
          <Label htmlFor="alias" className="text-xs">进程别名</Label>
          <Input
            id="alias"
            value={node.data.alias}
            onChange={(e) =>
              update(node.id, { alias: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_") }, `alias:${node.id}`)
            }
            className="h-8 font-mono text-xs"
          />
        </div>
        <label className="flex items-center justify-between text-sm">
          禁用节点
          <Switch checked={!!node.data.disabled} onCheckedChange={(v) => update(node.id, { disabled: v })} />
        </label>
      </Section>

      {def.builtin ? (
        <BuiltinSettings node={node} def={def} />
      ) : (
        <Section title="模块配置（conf/modules.config）">
          <div className="grid gap-1.5">
            <Label htmlFor="ext-args" className="font-mono text-xs">ext.args</Label>
            <Textarea
              id="ext-args"
              value={config.args ?? ""}
              placeholder="额外的命令行参数"
              onChange={(e) => setConfig({ args: e.target.value }, "args")}
              className="min-h-14 font-mono text-xs"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ext-prefix" className="font-mono text-xs">ext.prefix</Label>
            <Input
              id="ext-prefix"
              value={config.prefix ?? ""}
              placeholder="${meta.id}"
              onChange={(e) => setConfig({ prefix: e.target.value }, "prefix")}
              className="h-8 font-mono text-xs"
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">资源标签</Label>
            <Select value={config.label ?? def.label ?? "process_single"} onValueChange={(v) => setConfig({ label: v === def.label ? undefined : v }, "label")}>
              <SelectTrigger size="sm" className="font-mono text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LABELS.map((l) => (
                  <SelectItem key={l} value={l} className="font-mono text-xs">
                    {l}
                    {l === def.label && "（默认）"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center justify-between text-sm">
            发布输出到 outdir
            <Switch checked={config.publish !== false} onCheckedChange={(v) => setConfig({ publish: v }, "publish")} />
          </label>
          {def.container && (
            <div className="grid gap-1">
              <span className="text-xs text-muted-foreground">容器</span>
              <code className="break-all rounded bg-secondary px-2 py-1 font-mono text-[11px]">{def.container}</code>
            </div>
          )}
        </Section>
      )}

      <PortList ports={socketInputs(def)} title="输入" />
      <PortList ports={def.outputs} title="输出" />

      <Button variant="outline" size="sm" className="text-destructive" onClick={() => removeNodes([node.id])}>
        <Trash2 /> 删除节点
      </Button>
    </div>
  );
}

function PipelineInspector() {
  const params = useEditorStore((s) => s.params);
  const setParam = useEditorStore((s) => s.setParam);
  const nodes = useEditorStore((s) => s.nodes);
  const name = useEditorStore((s) => s.name);
  const description = useEditorStore((s) => s.description);
  const project = useEditorStore((s) => s.project);

  // Same schema the generated project ships as nextflow_schema.json.
  const schema = React.useMemo(() => {
    const meta = projectMeta({ name, description, project });
    return buildParamsSchema(meta.name, meta.description, referenceParams({ nodes }));
  }, [nodes, name, description, project]);

  return (
    <div className="grid gap-4 p-4">
      <div>
        <div className="font-serif text-lg font-semibold">流程参数</div>
        <p className="text-sm text-muted-foreground">
          与生成项目的 nextflow_schema.json 一致。选中画布中的节点可编辑节点配置。
        </p>
      </div>
      <SchemaForm schema={schema} values={params} onChange={setParam} />
    </div>
  );
}

export function Inspector({ className }: { className?: string }) {
  const node = useEditorStore(selectSelectedNode);
  return (
    <aside className={cn("glass flex min-h-0 flex-col rounded-xl", className)}>
      <ScrollArea className="min-h-0 flex-1">
        {node ? <NodeInspector key={node.id} node={node} /> : <PipelineInspector />}
      </ScrollArea>
    </aside>
  );
}
