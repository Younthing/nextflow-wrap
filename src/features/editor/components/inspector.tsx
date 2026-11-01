"use client";

import * as React from "react";
import Link from "next/link";
import { ExternalLink, Trash2 } from "lucide-react";

import { SourceDriftBanner } from "@/features/notebook/components/source-drift-banner";
import { useScriptModules } from "@/features/notebook/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  REFERENCE_FORMATS,
  REFERENCE_ID,
  SAMPLESHEET_ID,
} from "@/features/workflow/builtins";
import { resolveNodeDef } from "@/features/workflow/catalog";
import { moduleOrigin, newerScriptModule } from "@/features/workflow/origin";
import { portSignature, socketInputs } from "@/features/workflow/ports";
import { projectMeta } from "@/features/project/generate";
import { formatPublishRules, parsePublishRules } from "@/features/project/publish-rules";
import { buildParamsSchema, referenceParams } from "@/features/project/schema";
import { operatorFields } from "@/features/workflow/operators";
import samplesheetSchema from "@/data/samplesheet-schema.json";
import type { ModuleDef, PortDef } from "@/features/workflow/types";
import { cn } from "@/lib/utils";
import { EDITOR_CHROME_CLASS } from "../marquee-text";
import { categoryColor, portColor } from "../port-style";
import { selectSelectedNode, type FlowNode } from "../store";
import { useEditorStore } from "@/features/editor/editor-provider";
import { SchemaForm } from "./schema-form";

const LABELS = [
  "process_single",
  "process_low",
  "process_medium",
  "process_high",
  "process_long",
  "process_high_memory",
];

function Section({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("grid gap-3", className)}>
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground">
        {title}
      </h3>
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
            <span
              className="mt-1 size-2 shrink-0 rounded-full"
              style={{ background: portColor(p) }}
            />
            <div className="min-w-0">
              <span className="font-mono font-medium">{p.name}</span>{" "}
              <span className="font-mono text-muted-foreground">
                [{portSignature(p)}]
              </span>
              {p.description && (
                <p className="line-clamp-2 text-muted-foreground">
                  {p.description}
                </p>
              )}
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
        <FormField
          label={
            <Label htmlFor="samplesheet-path" className="font-mono text-xs">
              --input
            </Label>
          }
          htmlFor="samplesheet-path"
        >
          <Input
            id="samplesheet-path"
            value={String(params.input ?? "")}
            onChange={(e) => setParam("input", e.target.value)}
            className="h-8 font-mono text-xs"
          />
        </FormField>
        <div className="text-xs text-muted-foreground">
          CSV 列（assets/schema_input.json）：
        </div>
        <div className="flex flex-wrap gap-1.5">
          {columns.map(([name]) => (
            <Badge
              key={name}
              variant={required.has(name) ? "default" : "secondary"}
              className="font-mono"
            >
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
        <FormField label="参数名" htmlFor="ref-param">
          <Input
            id="ref-param"
            value={param}
            onChange={(e) =>
              update(
                node.id,
                { settings: { ...settings, param: e.target.value.trim() } },
                `ref:${node.id}:param`,
              )
            }
            className="h-8 font-mono text-xs"
          />
        </FormField>
        <FormField label="文件格式">
          <Select
            value={String(settings.format ?? "other")}
            onValueChange={(format) =>
              update(node.id, { settings: { ...settings, format } })
            }
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
        </FormField>
        <label className="flex items-center justify-between text-sm">
          可选文件
          <Switch
            checked={settings.optional === true}
            onCheckedChange={(optional) => update(node.id, { settings: { ...settings, optional } })}
          />
        </label>
        {param && (
          <FormField
            label={
              <Label htmlFor="ref-value" className="font-mono text-xs">
                --{param}
              </Label>
            }
            htmlFor="ref-value"
          >
            <Input
              id="ref-value"
              value={String(params[param] ?? "")}
              placeholder="路径或 URL，如 s3://…/genome.fa"
              onChange={(e) => setParam(param, e.target.value)}
              className="h-8 font-mono text-xs"
            />
          </FormField>
        )}
      </Section>
    );
  }

  const fields = operatorFields(def.id);
  if (!fields) return null;
  return (
    <Section title="算子">
      {fields.map((field) => {
        const id = `${node.id}-${field.key}`;
        if (field.type === "boolean") {
          return (
            <label key={field.key} className="flex items-center justify-between text-sm">
              {field.label}
              <Switch
                checked={settings[field.key] !== false && settings[field.key] !== "false"}
                onCheckedChange={(value) => update(node.id, { settings: { ...settings, [field.key]: value } })}
              />
            </label>
          );
        }
        return (
          <FormField key={field.key} label={field.label} htmlFor={id} hint={field.hint}>
            <Input
              id={id}
              value={String(settings[field.key] ?? "")}
              onChange={(event) => {
                const raw = event.target.value;
                const value = field.type === "number" ? (raw === "" ? "" : Number(raw)) : raw;
                update(node.id, { settings: { ...settings, [field.key]: value } }, `op:${node.id}:${field.key}`);
              }}
              className="h-8 font-mono text-xs"
            />
          </FormField>
        );
      })}
    </Section>
  );
}

function NodeInspector({ node }: { node: FlowNode }) {
  const index = useEditorStore((s) => s.index);
  const update = useEditorStore((s) => s.updateNodeData);
  const removeNodes = useEditorStore((s) => s.removeNodes);
  const scripts = useScriptModules();
  const def = resolveNodeDef(index, node.data);
  if (!def)
    return (
      <div className="p-4 text-sm text-destructive">
        未知模块 {node.data.moduleId}
      </div>
    );

  const { config } = node.data;
  const origin = moduleOrigin(def);
  const view = scripts.data?.modules.find((mod) => mod.id === def.id);
  const newer = newerScriptModule(def, scripts.data?.modules ?? []);
  const setConfig = (patch: Partial<typeof config>, key: string) =>
    update(
      node.id,
      { config: { ...config, ...patch } },
      `config:${node.id}:${key}`,
    );

  return (
    <div className="grid gap-6 p-4">
      <div className="grid gap-2">
        <div className="flex items-center gap-2">
          <span
            className="size-2.5 rounded-full"
            style={{ background: categoryColor(def.category) }}
          />
          <span className="text-xs text-muted-foreground">{def.category}</span>
          {origin === "nf-core" && (
            <a
              href={`https://nf-co.re/modules/${def.path.replace("/", "_")}`}
              target="_blank"
              rel="noreferrer"
              className="ml-auto flex items-center gap-1 text-xs text-primary hover:underline"
            >
              nf-core 文档 <ExternalLink className="size-3" />
            </a>
          )}
          {origin === "script" && def.sourceNotebookId && (
            <Link
              href={`/notebooks/${def.sourceNotebookId}`}
              className="ml-auto flex items-center gap-1 text-xs text-primary hover:underline"
            >
              在笔记本中打开源
            </Link>
          )}
        </div>
        <div className="font-serif text-lg font-semibold">
          {origin === "nf-core" ? def.process : def.name}
          {def.version ? <span className="ml-2 font-mono text-xs text-muted-foreground">{def.version}</span> : null}
        </div>
        <p className="text-sm text-muted-foreground">{def.description}</p>
        {view?.sourceChanged && view.sourceNotebookId && view.sourceNotebookRev !== undefined && view.sourceNotebookRevCurrent !== undefined && (
          <SourceDriftBanner
            notebookId={view.sourceNotebookId}
            notebookName={view.sourceNotebookName}
            pinnedRev={view.sourceNotebookRev}
            currentRev={view.sourceNotebookRevCurrent}
            cellChanges={view.cellChanges}
            version={view.version}
          />
        )}
        {newer && (
          <Button type="button" size="sm" variant="outline" onClick={() => update(node.id, { moduleId: newer.id })}>
            有新版本 {newer.version} · 更新
          </Button>
        )}
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
        <FormField label="进程别名" htmlFor="alias">
          <Input
            id="alias"
            value={node.data.alias}
            onChange={(e) =>
              update(
                node.id,
                {
                  alias: e.target.value
                    .toUpperCase()
                    .replace(/[^A-Z0-9_]/g, "_"),
                },
                `alias:${node.id}`,
              )
            }
            className="h-8 font-mono text-xs"
          />
        </FormField>
        <label className="flex items-center justify-between text-sm">
          禁用节点
          <Switch
            checked={!!node.data.disabled}
            onCheckedChange={(v) => update(node.id, { disabled: v })}
          />
        </label>
      </Section>

      {origin === "builtin" ? (
        <BuiltinSettings node={node} def={def} />
      ) : origin === "script" ? (
        <Section title="这一次用法">
          <FormField
            label={<Label htmlFor="ext-args" className="font-mono text-xs">args</Label>}
            htmlFor="ext-args"
          >
            <Textarea
              id="ext-args"
              value={config.args ?? ""}
              placeholder="额外的命令行参数"
              onChange={(event) => setConfig({ args: event.target.value }, "args")}
              className="min-h-14 font-mono text-xs"
            />
          </FormField>
          <FormField label="publish" htmlFor="publish-path" hint="发布到这个目录，例如 results/qc/">
            <Input
              id="publish-path"
              value={config.publishPath ?? ""}
              onChange={(event) => setConfig({ publishPath: event.target.value }, "publishPath")}
              className="h-8 font-mono text-xs"
            />
          </FormField>
          <label className="flex items-center justify-between text-sm">
            发布输出
            <Switch checked={config.publish !== false} onCheckedChange={(value) => setConfig({ publish: value }, "publish")} />
          </label>
          <FormField label="label">
            <Select value={config.label ?? def.label ?? "process_low"} onValueChange={(value) => setConfig({ label: value }, "label")}>
              <SelectTrigger size="sm" className="font-mono text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {LABELS.map((label) => (
                  <SelectItem key={label} value={label} className="font-mono text-xs">{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <p className="text-xs text-muted-foreground">
            这里只改这一次用法，不改模块定义。改代码要回到笔记本，再发布新版本。
          </p>
        </Section>
      ) : (
        <Section title="模块配置（conf/modules.config）">
          <FormField
            label={
              <Label htmlFor="ext-args" className="font-mono text-xs">
                ext.args
              </Label>
            }
            htmlFor="ext-args"
          >
            <Textarea
              id="ext-args"
              value={config.args ?? ""}
              placeholder="额外的命令行参数"
              onChange={(e) => setConfig({ args: e.target.value }, "args")}
              className="min-h-14 font-mono text-xs"
            />
          </FormField>
          <FormField
            label={
              <Label htmlFor="ext-prefix" className="font-mono text-xs">
                ext.prefix
              </Label>
            }
            htmlFor="ext-prefix"
          >
            <Input
              id="ext-prefix"
              value={config.prefix ?? ""}
              placeholder="${meta.id}"
              onChange={(e) => setConfig({ prefix: e.target.value }, "prefix")}
              className="h-8 font-mono text-xs"
            />
          </FormField>
          <FormField label="资源标签">
            <Select
              value={config.label ?? def.label ?? "process_single"}
              onValueChange={(v) =>
                setConfig({ label: v === def.label ? undefined : v }, "label")
              }
            >
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
          </FormField>
          <label className="flex items-center justify-between text-sm">
            发布输出到 outdir
            <Switch
              checked={config.publish !== false}
              onCheckedChange={(v) => setConfig({ publish: v }, "publish")}
            />
          </label>
          <FormField label="发布路径" htmlFor="publish-path" hint="例如 ${params.outdir}/${meta.id}">
            <Input
              id="publish-path"
              value={config.publishPath ?? ""}
              onChange={(event) => setConfig({ publishPath: event.target.value }, "publishPath")}
              className="h-8 font-mono text-xs"
            />
          </FormField>
          <FormField label="发布匹配" htmlFor="publish-pattern" hint="只保存匹配这个 glob 的文件">
            <Input
              id="publish-pattern"
              value={config.publishPattern ?? ""}
              placeholder="*_counts.txt"
              onChange={(event) => setConfig({ publishPattern: event.target.value }, "publishPattern")}
              className="h-8 font-mono text-xs"
            />
          </FormField>
          <FormField label="重命名" htmlFor="publish-save" hint="filename -> &quot;foo_$filename&quot;">
            <Input
              id="publish-save"
              value={config.publishSaveAs ?? ""}
              onChange={(event) => setConfig({ publishSaveAs: event.target.value }, "publishSaveAs")}
              className="h-8 font-mono text-xs"
            />
          </FormField>
          <FormField label="更多发布目录" htmlFor="publish-rules" hint="每行 path|pattern|saveAs">
            <Textarea
              id="publish-rules"
              value={formatPublishRules(config.publishDirs)}
              onChange={(event) => setConfig({ publishDirs: parsePublishRules(event.target.value) }, "publishDirs")}
              className="min-h-14 font-mono text-xs"
            />
          </FormField>
          <FormField label="when" htmlFor="when-expr" hint="为真才执行。空通道用「空时执行」。">
            <Input
              id="when-expr"
              value={config.when ?? ""}
              placeholder="x == 'EMPTY'"
              onChange={(event) => setConfig({ when: event.target.value }, "when")}
              className="h-8 font-mono text-xs"
            />
          </FormField>
          <label className="flex items-center justify-between text-sm">
            空时执行
            <Switch
              checked={!!config.whenEmpty}
              onCheckedChange={(whenEmpty) => setConfig({ whenEmpty }, "whenEmpty")}
            />
          </label>
          <label className="flex items-center justify-between text-sm">
            可跳过（mix 旁路）
            <Switch checked={!!config.skip} onCheckedChange={(skip) => setConfig({ skip }, "skip")} />
          </label>
          <FormField label="errorStrategy" htmlFor="error-strategy">
            <Select
              value={config.errorStrategy ?? "default"}
              onValueChange={(value) => setConfig({ errorStrategy: value === "default" ? undefined : value }, "errorStrategy")}
            >
              <SelectTrigger id="error-strategy" size="sm" className="font-mono text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["default", "ignore", "retry", "finish", "terminate"].map((strategy) => (
                  <SelectItem key={strategy} value={strategy} className="font-mono text-xs">
                    {strategy === "default" ? "默认" : strategy}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="memory" htmlFor="memory-expr" hint="闭包体，可引用输入文件">
            <Input
              id="memory-expr"
              value={config.memory ?? ""}
              placeholder="reads.size() < 70.KB ? 1.GB : 5.GB"
              onChange={(event) => setConfig({ memory: event.target.value }, "memory")}
              className="h-8 font-mono text-xs"
            />
          </FormField>
          <FormField label="cpus" htmlFor="cpus-expr">
            <Input
              id="cpus-expr"
              value={config.cpus ?? ""}
              onChange={(event) => setConfig({ cpus: event.target.value }, "cpus")}
              className="h-8 font-mono text-xs"
            />
          </FormField>
          <FormField label="可选输出" htmlFor="optional-outputs" hint="端口名，逗号分隔。下游用 ifEmpty。">
            <Input
              id="optional-outputs"
              value={config.optionalOutputs ?? ""}
              onChange={(event) => setConfig({ optionalOutputs: event.target.value }, "optionalOutputs")}
              className="h-8 font-mono text-xs"
            />
          </FormField>
          {def.container && (
            <div className="grid gap-1">
              <span className="text-xs text-muted-foreground">容器</span>
              <code className="break-all rounded bg-secondary px-2 py-1 font-mono text-[11px]">
                {def.container}
              </code>
            </div>
          )}
        </Section>
      )}

      <PortList ports={socketInputs(def)} title="输入" />
      <PortList ports={def.outputs} title="输出" />

      <Button
        variant="outline"
        size="sm"
        className="text-destructive"
        onClick={() => removeNodes([node.id])}
      >
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
    return buildParamsSchema(
      meta.name,
      meta.description,
      referenceParams({ nodes }),
    );
  }, [nodes, name, description, project]);

  return (
    <div className="grid gap-4 p-4">
      <div>
        <div className="font-serif text-lg font-semibold">流程参数</div>
        <p className="text-sm text-muted-foreground">
          与生成项目的 nextflow_schema.json
          一致。选中画布中的节点可编辑节点配置。
        </p>
      </div>
      <SchemaForm schema={schema} values={params} onChange={setParam} />
    </div>
  );
}

export function Inspector({ className }: { className?: string }) {
  const node = useEditorStore(selectSelectedNode);
  return (
    <aside
      aria-label="流程检查器"
      className={cn(
        EDITOR_CHROME_CLASS,
        "glass flex min-h-0 flex-col rounded-xl",
        className,
      )}
    >
      <ScrollArea className="min-h-0 flex-1">
        {node ? (
          <NodeInspector key={node.id} node={node} />
        ) : (
          <PipelineInspector />
        )}
      </ScrollArea>
    </aside>
  );
}
