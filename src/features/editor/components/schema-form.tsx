"use client";

import * as React from "react";
import { ChevronRight, HelpCircle } from "lucide-react";

import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { JsonSchema } from "@/features/workflow/queries";
import type { PipelineParams, WidgetValue } from "@/features/workflow/types";
import { cn } from "@/lib/utils";

interface Group {
  id: string;
  title: string;
  description?: string;
  required: Set<string>;
  fields: [string, JsonSchema][];
}

/** nf-core schemas group params under `$defs`, referenced from `allOf`. */
export function schemaGroups(schema: JsonSchema): Group[] {
  const defs = schema.$defs ?? {};
  const order = schema.allOf?.map((r) => r.$ref.replace("#/$defs/", "")) ?? Object.keys(defs);
  const groups = order
    .filter((id) => defs[id])
    .map((id) => ({
      id,
      title: defs[id].title ?? id,
      description: defs[id].description,
      required: new Set(defs[id].required ?? []),
      fields: Object.entries(defs[id].properties ?? {}),
    }));
  if (schema.properties) {
    groups.push({
      id: "_top",
      title: "其他参数",
      description: undefined,
      required: new Set(schema.required ?? []),
      fields: Object.entries(schema.properties),
    });
  }
  return groups;
}

const isPathFormat = (f?: string) => f === "file-path" || f === "directory-path" || f === "path";

function Field({
  name,
  spec,
  required,
  value,
  onChange,
}: {
  name: string;
  spec: JsonSchema;
  required: boolean;
  value: WidgetValue | undefined;
  onChange: (value: WidgetValue | undefined) => void;
}) {
  const id = `param-${name}`;
  const type = Array.isArray(spec.type) ? spec.type[0] : spec.type;
  const placeholder = spec.default !== undefined ? String(spec.default) : undefined;

  const label = (
    <div className="flex items-center gap-1">
      <Label htmlFor={id} className="font-mono text-xs">
        --{name}
        {required && <span className="text-destructive">*</span>}
      </Label>
      {(spec.description || spec.help_text) && (
        <Tooltip>
          <TooltipTrigger asChild>
            <HelpCircle className="size-3.5 text-muted-foreground" />
          </TooltipTrigger>
          <TooltipContent className="max-w-sm">
            {spec.description}
            {spec.help_text && <div className="mt-1 text-muted-foreground">{spec.help_text}</div>}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );

  if (type === "boolean") {
    return (
      <div className="flex items-center justify-between gap-2">
        {label}
        <Switch
          id={id}
          checked={value === undefined ? spec.default === true : value === true}
          onCheckedChange={(v) => onChange(v === spec.default ? undefined : v)}
        />
      </div>
    );
  }

  if (spec.enum) {
    return (
      <FormField label={label}>
        <Select
          value={value === undefined ? String(spec.default ?? "") : String(value)}
          onValueChange={(v) => onChange(v === spec.default ? undefined : v)}
        >
          <SelectTrigger id={id} size="sm" className="font-mono text-xs">
            <SelectValue placeholder="选择…" />
          </SelectTrigger>
          <SelectContent>
            {spec.enum.map((opt) => (
              <SelectItem key={String(opt)} value={String(opt)} className="font-mono text-xs">
                {String(opt)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
    );
  }

  const numeric = type === "integer" || type === "number";
  return (
    <FormField label={label}>
      <Input
        id={id}
        type={numeric ? "number" : "text"}
        value={value === undefined ? "" : String(value)}
        placeholder={placeholder}
        aria-invalid={required && (value === undefined || value === "")}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") onChange(undefined);
          else onChange(numeric ? Number(raw) : raw);
        }}
        className={cn("h-8 text-xs", (isPathFormat(spec.format) || numeric) && "font-mono")}
      />
    </FormField>
  );
}

export function SchemaForm({
  schema,
  values,
  onChange,
  extraFields = [],
}: {
  schema: JsonSchema;
  values: PipelineParams;
  onChange: (key: string, value: WidgetValue | undefined) => void;
  /** Params that come from the canvas (e.g. reference nodes), shown first. */
  extraFields?: { name: string; spec: JsonSchema }[];
}) {
  const [showHidden, setShowHidden] = React.useState(false);
  const [closed, setClosed] = React.useState<Set<string>>(new Set());
  const groups = React.useMemo(() => schemaGroups(schema), [schema]);
  const known = new Set(groups.flatMap((g) => g.fields.map(([n]) => n)));
  const extras = extraFields.filter((f) => !known.has(f.name));

  const renderGroup = (id: string, title: string, fields: [string, JsonSchema][], required: Set<string>, description?: string) => {
    const visible = fields.filter(([, spec]) => showHidden || !spec.hidden);
    if (visible.length === 0) return null;
    const open = !closed.has(id);
    return (
      <section key={id} className="rounded-lg border border-border">
        <button
          type="button"
          className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-sm font-medium"
          onClick={() =>
            setClosed((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
        >
          <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} />
          {title}
          <span className="ml-auto text-xs font-normal text-muted-foreground">{visible.length}</span>
        </button>
        {open && (
          <div className="grid gap-3 border-t border-border px-3 py-3">
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
            {visible.map(([name, spec]) => (
              <Field
                key={name}
                name={name}
                spec={spec}
                required={required.has(name)}
                value={values[name]}
                onChange={(v) => onChange(name, v)}
              />
            ))}
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="grid gap-2">
      {extras.length > 0 &&
        renderGroup(
          "_canvas",
          "画布中的参考文件",
          extras.map((f) => [f.name, f.spec]),
          new Set(extras.map((f) => f.name)),
          "这些参数来自画布上的参考文件节点。",
        )}
      {groups.map((g) => renderGroup(g.id, g.title, g.fields, g.required, g.description))}
      <label className="flex items-center gap-2 px-1 pt-1 text-xs text-muted-foreground">
        <Switch checked={showHidden} onCheckedChange={setShowHidden} className="scale-90" />
        显示高级（隐藏）参数
      </label>
    </div>
  );
}
