"use client";

import * as React from "react";
import { RadioGroup } from "radix-ui";
import { Cloud, Server, Ship } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { FormField as Field } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  ENGINE_LABELS,
  EXECUTORS,
  executorDef,
  isRealEngine,
  REGISTRIES,
  type ExecutorField,
  type ExecutorId,
  type LaunchConfig,
} from "@/features/project/launch";
import { cn } from "@/lib/utils";

const EXECUTOR_ICONS: Record<
  ExecutorId,
  React.ComponentType<{ className?: string }>
> = {
  local: Server,
  slurm: Server,
  "google-batch": Cloud,
  "aws-batch": Cloud,
  "azure-batch": Cloud,
  k8s: Ship,
};

function SettingInput({
  field,
  value,
  onChange,
}: {
  field: ExecutorField;
  value: string | number | boolean | undefined;
  onChange: (v: string | number | boolean) => void;
}) {
  const id = `${React.useId()}-${field.key}`;
  if (field.type === "boolean") {
    return (
      <label className="flex h-9 items-center justify-between rounded-md border border-input px-3 text-sm">
        {field.label}
        <Switch
          aria-label={field.label}
          checked={value === true}
          onCheckedChange={onChange}
        />
      </label>
    );
  }
  return (
    <Field
      label={`${field.label}${field.required ? " *" : ""}`}
      htmlFor={id}
      hint={field.help}
    >
      <Input
        id={id}
        aria-describedby={field.help ? `${id}-hint` : undefined}
        aria-required={field.required || undefined}
        type={field.type === "number" ? "number" : "text"}
        value={value === undefined ? "" : String(value)}
        placeholder={field.placeholder}
        onChange={(e) =>
          onChange(
            field.type === "number" && e.target.value !== ""
              ? Number(e.target.value)
              : e.target.value,
          )
        }
        className="h-9 font-mono text-xs"
      />
    </Field>
  );
}

export function EnvironmentForm({
  config,
  onChange,
  real,
}: {
  config: LaunchConfig;
  onChange: (c: LaunchConfig) => void;
  real?: boolean;
}) {
  const formId = React.useId();
  const def = executorDef(config.executor);
  const set = (patch: Partial<LaunchConfig>) =>
    onChange({ ...config, ...patch });

  return (
    <div className="grid gap-6">
      {!real && (
        <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
          <Badge variant="warning" className="mt-0.5">预览</Badge>
          <span>预览环境不会连接真实的集群或云执行器。启动后由模拟运行展示流程和结果。</span>
        </p>
      )}
      <section className="grid gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground">
          运行在哪里
        </h3>
        <RadioGroup.Root
          className="grid grid-cols-2 gap-2 lg:grid-cols-3"
          value={config.executor}
          aria-label="执行器"
          onValueChange={(value) => {
            const next = executorDef(value as ExecutorId);
            const engine = next.engines.includes(config.engine)
              ? config.engine
              : next.engines[0];
            const workDir =
              !config.workDir || config.workDir === def.workDirHint
                ? next.workDirHint
                : config.workDir;
            set({ executor: next.id, engine, workDir, settings: {} });
          }}
        >
          {EXECUTORS.map((e) => {
            const Icon = EXECUTOR_ICONS[e.id];
            const active = e.id === config.executor;
            return (
              <RadioGroup.Item
                value={e.id}
                key={e.id}
                type="button"
                disabled={real && e.id !== "local"}
                className={cn(
                  real && e.id !== "local" && "cursor-not-allowed opacity-40",
                  "flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors hover:bg-accent",
                  active
                    ? "border-primary bg-primary/10 shadow-sm"
                    : "border-border",
                )}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Icon
                    className={cn(
                      "size-4",
                      active ? "text-primary" : "text-muted-foreground",
                    )}
                  />
                  {e.name}
                  {(!real || e.id !== "local") && <Badge variant="warning">预览</Badge>}
                </span>
                <span className="text-[11px] leading-snug text-muted-foreground">
                  {e.description}
                </span>
              </RadioGroup.Item>
            );
          })}
        </RadioGroup.Root>
      </section>

      {def.fields.length > 0 && (
        <section className="grid gap-3">
          <h3 className="text-xs font-semibold text-muted-foreground">
            {def.name} 设置
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {def.fields.map((f) => (
              <SettingInput
                key={f.key}
                field={f}
                value={config.settings[f.key]}
                onChange={(v) =>
                  set({ settings: { ...config.settings, [f.key]: v } })
                }
              />
            ))}
          </div>
        </section>
      )}

      <section className="grid gap-3">
        <h3 className="text-xs font-semibold text-muted-foreground">
          软件环境和存储
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="容器 / 环境（-profile）"
            htmlFor={`${formId}-engine`}
            hint={
              config.engine === "shell"
                ? "不使用 -profile，进程在本机 shell 里直接执行"
                : undefined
            }
          >
            <Select
              value={config.engine}
              onValueChange={(engine) =>
                set({ engine: engine as LaunchConfig["engine"] })
              }
            >
              <SelectTrigger id={`${formId}-engine`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {def.engines
                  .filter((e) => !real || isRealEngine(e))
                  .map((e) => (
                    <SelectItem key={e} value={e}>
                      {ENGINE_LABELS[e]}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="镜像仓库" htmlFor={`${formId}-registry`}>
            <Select
              value={config.registry}
              onValueChange={(registry) => set({ registry })}
            >
              <SelectTrigger id={`${formId}-registry`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REGISTRIES.map((r) => (
                  <SelectItem key={r} value={r} className="font-mono">
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="工作目录（workDir）" htmlFor={`${formId}-workdir`}>
            <Input
              id={`${formId}-workdir`}
              disabled={real}
              value={config.workDir}
              placeholder={def.workDirHint}
              onChange={(e) => set({ workDir: e.target.value })}
              className="h-9 font-mono text-xs"
            />
          </Field>
          <Field
            label="额外 profile"
            htmlFor={`${formId}-profiles`}
            hint={
              real
                ? "支持 test、debug、emulate_amd64；逗号分隔"
                : "逗号分隔，例如 test,gpu"
            }
          >
            <Input
              id={`${formId}-profiles`}
              aria-describedby={`${formId}-profiles-hint`}
              value={config.extraProfiles.join(",")}
              placeholder="test"
              onChange={(e) =>
                set({
                  extraProfiles: e.target.value
                    .split(",")
                    .map((p) => p.trim())
                    .filter((p, i, all) => p || i === all.length - 1),
                })
              }
              onBlur={() =>
                set({ extraProfiles: config.extraProfiles.filter(Boolean) })
              }
              className="h-9 font-mono text-xs"
            />
          </Field>
          <Field
            label="运行名称（-name）"
            htmlFor={`${formId}-run-name`}
            hint="留空时自动生成"
          >
            <Input
              id={`${formId}-run-name`}
              aria-describedby={`${formId}-run-name-hint`}
              value={config.runName ?? ""}
              placeholder="tender_curie"
              onChange={(e) =>
                set({
                  runName: e.target.value.replace(/[^\w-]/g, "_") || undefined,
                })
              }
              className="h-9 font-mono text-xs"
            />
          </Field>
          {real ? (
            <p className="self-end text-xs text-muted-foreground">
              工作目录自动隔离；断点续跑请从运行详情选择来源记录。
            </p>
          ) : (
            <label className="flex h-9 items-center justify-between self-end rounded-md border border-input px-3 text-sm">
              断点续跑（-resume）
              <Switch
                aria-label="断点续跑"
                checked={config.resume}
                onCheckedChange={(resume) => set({ resume })}
              />
            </label>
          )}
        </div>
      </section>
    </div>
  );
}
