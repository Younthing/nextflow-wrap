"use client";

import * as React from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { AlertTriangle, Ban, Boxes } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PathInput } from "@/features/files/components/path-input";
import { FOLDER_ID, isInputNode, pathName } from "@/features/workflow/builtins";
import { resolveNodeDef } from "@/features/workflow/catalog";
import { inputParamName } from "@/features/workflow/inputs";
import { moduleOrigin } from "@/features/workflow/origin";
import {
  inHandle,
  outHandle,
  portSignature,
  socketInputs,
  widgetInputs,
} from "@/features/workflow/ports";
import type {
  ModuleDef,
  PortDef,
  WidgetValue,
} from "@/features/workflow/types";
import { cn } from "@/lib/utils";
import { categoryColor, portColor } from "../port-style";
import { type FlowNode } from "../store";
import { useEditorStore } from "@/features/editor/editor-provider";

function PortTooltip({
  port,
  children,
}: {
  port: PortDef;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top" className="max-w-sm">
        <div className="font-mono text-[11px]">[{portSignature(port)}]</div>
        {port.description && (
          <div className="mt-1 line-clamp-4">{port.description}</div>
        )}
        {port.collect && (
          <div className="mt-1 text-primary">
            可连接多个输出，会自动合并收集
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

function PortRow({
  input,
  output,
  linkedInputs,
}: {
  input?: PortDef;
  output?: PortDef;
  linkedInputs: Set<string>;
}) {
  return (
    <div className="relative flex h-7 items-center justify-between gap-3 px-3 text-xs">
      {input ? (
        <PortTooltip port={input}>
          <div className="flex min-w-0 items-center gap-1.5">
            <Handle
              type="target"
              position={Position.Left}
              id={inHandle(input.name)}
              className={cn("nf-handle", input.collect && "nf-handle-collect")}
              style={
                { "--handle-color": portColor(input) } as React.CSSProperties
              }
            />
            <span
              className={cn(
                "truncate",
                !linkedInputs.has(input.name) && "text-muted-foreground",
              )}
            >
              {input.name}
            </span>
          </div>
        </PortTooltip>
      ) : (
        <span />
      )}
      {output && (
        <PortTooltip port={output}>
          <div className="flex min-w-0 items-center justify-end gap-1.5">
            <span className="truncate">{output.name}</span>
            <Handle
              type="source"
              position={Position.Right}
              id={outHandle(output.name)}
              className="nf-handle"
              style={
                { "--handle-color": portColor(output) } as React.CSSProperties
              }
            />
          </div>
        </PortTooltip>
      )}
    </div>
  );
}

function WidgetField({
  port,
  value,
  onChange,
}: {
  port: PortDef;
  value: WidgetValue | undefined;
  onChange: (value: WidgetValue) => void;
}) {
  const type = port.widget;
  return (
    <label
      className="nodrag flex h-7 items-center justify-between gap-2 px-3 text-xs"
      title={port.description}
    >
      <span className="truncate text-muted-foreground">{port.name}</span>
      {type === "boolean" ? (
        <Switch
          checked={value === true}
          onCheckedChange={onChange}
          className="scale-90"
        />
      ) : (
        <Input
          value={value === undefined ? "" : String(value)}
          type={
            type === "integer" || type === "float" || type === "number"
              ? "number"
              : "text"
          }
          onChange={(e) =>
            onChange(
              e.target.type === "number" && e.target.value !== ""
                ? Number(e.target.value)
                : e.target.value,
            )
          }
          className="h-6 w-28 px-2 font-mono text-xs"
        />
      )}
    </label>
  );
}

function NodeBody({
  id,
  def,
  data,
}: {
  id: string;
  def: ModuleDef;
  data: FlowNode["data"];
}) {
  const setWidget = useEditorStore((s) => s.setWidget);
  const linked = useEditorStore(
    React.useCallback(
      (s) =>
        s.edges
          .filter((e) => e.target === id)
          .map((e) => e.targetHandle?.slice(3) ?? "")
          .sort()
          .join("|"),
      [id],
    ),
  );
  const linkedInputs = React.useMemo(
    () => new Set(linked.split("|")),
    [linked],
  );

  const inputs = socketInputs(def);
  const widgets = widgetInputs(def);
  const rows = Math.max(inputs.length, def.outputs.length);

  return (
    <>
      <div className="py-1.5">
        {Array.from({ length: rows }, (_, i) => (
          <PortRow
            key={i}
            input={inputs[i]}
            output={def.outputs[i]}
            linkedInputs={linkedInputs}
          />
        ))}
      </div>
      {widgets.length > 0 && (
        <div className="border-t border-border py-1.5">
          {widgets.map((p) => (
            <WidgetField
              key={p.name}
              port={p}
              value={data.widgets[p.name]}
              onChange={(v) => setWidget(id, p.name, v)}
            />
          ))}
        </div>
      )}
    </>
  );
}

/** File and folder input nodes: the path is picked right on the card. */
function InputNodeBody({ id, def, data }: { id: string; def: ModuleDef; data: FlowNode["data"] }) {
  const update = useEditorStore((s) => s.updateNodeData);
  const settings = data.settings ?? {};
  const path = String(settings.path ?? "");
  const folder = def.id === FOLDER_ID;
  const output = def.outputs[0];
  const format = output?.elements.find((el) => el.kind === "file")?.format;
  const missing = !path.trim() && settings.optional !== true;
  return (
    <>
      <div className="nodrag grid gap-1.5 px-3 pt-2.5 pb-1">
        <PathInput
          kind={folder ? "directory" : "file"}
          value={path}
          placeholder={folder ? "选择文件夹…" : "选择文件…"}
          aria-label={folder ? "文件夹路径" : "文件路径"}
          aria-invalid={missing || undefined}
          onChange={(value) => update(id, { settings: { ...settings, path: value } }, `input:${id}:path`)}
          className="h-7 px-2 text-xs"
        />
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {missing ? (
            <span className="text-destructive">{folder ? "还没有选择文件夹" : "还没有选择文件"}</span>
          ) : (
            <span className="font-mono">--{inputParamName(data.alias)}</span>
          )}
          {format && (
            <span className="ml-auto rounded-full bg-secondary px-1.5 py-0.5 font-mono text-[10px]">
              {folder ? "文件夹" : format}
            </span>
          )}
        </div>
      </div>
      <div className="pb-1.5">
        {output && <PortRow output={output} linkedInputs={new Set()} />}
      </div>
    </>
  );
}

export function ModuleNode({ id, data, selected }: NodeProps<FlowNode>) {
  const index = useEditorStore((s) => s.index);
  const def = resolveNodeDef(index, data);

  if (!def) {
    return (
      <div className="glass-strong flex w-60 items-center gap-2 rounded-xl border-destructive/50 p-3 text-sm text-destructive">
        <AlertTriangle className="size-4" />
        未知模块：{data.moduleId}
      </div>
    );
  }

  const accent = categoryColor(def.category);
  const origin = moduleOrigin(def);
  const subtitle = origin === "script"
    ? `${def.name}${def.version ? ` · ${def.version}` : ""}`
    : isInputNode(def.id)
      ? pathName(String(data.settings?.path ?? "")) || def.name
      : def.builtin
      ? data.settings?.param
        ? `--${data.settings.param}`
        : def.name
      : def.path;

  return (
    <div
      className={cn(
        "glass-strong w-64 rounded-xl text-foreground transition-shadow",
        selected && "ring-2 ring-primary/70",
        data.disabled && "opacity-50",
      )}
    >
      <div
        className="flex items-center gap-2 rounded-t-xl border-b border-border px-3 py-2"
        style={{
          background: `linear-gradient(90deg, color-mix(in oklch, ${accent} 28%, transparent), transparent)`,
        }}
      >
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{ background: accent }}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-xs font-semibold">
            {data.alias}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {subtitle}
          </div>
        </div>
        {data.disabled && (
          <Ban className="size-3.5 text-muted-foreground" aria-label="已禁用" />
        )}
        {(data.config.label ?? def.label) && (
          <span className="flex items-center gap-1 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
            <Boxes className="size-3" />
            {(data.config.label ?? def.label)!.replace("process_", "")}
          </span>
        )}
      </div>
      {isInputNode(def.id) ? (
        <InputNodeBody id={id} def={def} data={data} />
      ) : (
        <NodeBody id={id} def={def} data={data} />
      )}
    </div>
  );
}
