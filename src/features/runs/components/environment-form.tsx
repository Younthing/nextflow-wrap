"use client";

import * as React from "react";
import { RadioGroup } from "radix-ui";
import { ChevronDown, Cloud, Server, Ship } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  isHostShell,
  EXECUTORS,
  executorDef,
  EXTRA_PROFILES,
  isGridExecutor,
  REGISTRIES,
  type ExecutorField,
  type ExecutorDef,
  type ExecutorId,
  type LaunchConfig,
} from "@/features/project/launch";
import type { RemoteHost } from "@/features/remote/types";
import { cn } from "@/lib/utils";

/** From a cluster's login node Nextflow can run tasks there itself or submit them to the cluster's scheduler. */
const onHost = (id: ExecutorId) => id === "local" || isGridExecutor(id);

function executorIcon(id: ExecutorId): React.ComponentType<{ className?: string }> {
  if (id === "k8s") return Ship;
  return id.endsWith("-batch") ? Cloud : Server;
}

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
  remotes = [],
}: {
  config: LaunchConfig;
  onChange: (c: LaunchConfig) => void;
  real?: boolean;
  /** Clusters from the settings page; with any, the form asks where Nextflow starts. */
  remotes?: RemoteHost[];
}) {
  const formId = React.useId();
  const [showExecutors, setShowExecutors] = React.useState(false);
  const def = executorDef(config.executor);
  const set = (patch: Partial<LaunchConfig>) =>
    onChange({ ...config, ...patch });
  const host = remotes.find((candidate) => candidate.id === config.remote);
  const executors = host ? EXECUTORS.filter((e) => onHost(e.id)) : EXECUTORS;
  const groups = [
    { label: "集群调度器", options: executors.filter((e) => isGridExecutor(e.id)) },
    { label: "云与容器平台", options: executors.filter((e) => !onHost(e.id)) },
  ];
  const executorOption = (executor: ExecutorDef) => {
    const Icon = executorIcon(executor.id);
    const active = executor.id === config.executor;
    const loginNode = host && executor.id === "local";
    return (
      <RadioGroup.Item
        value={executor.id}
        key={executor.id}
        type="button"
        className={cn(
          "flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
          active ? "border-primary bg-primary/10 shadow-sm" : "border-border",
        )}
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          <Icon className={cn("size-4", active ? "text-primary" : "text-muted-foreground")} />
          {loginNode ? "登录节点" : executor.name}
        </span>
        <span className="text-xs leading-snug text-muted-foreground">
          {loginNode ? "在登录节点上直接执行任务，只适合轻量流程。" : host ? executor.description.replace("Nextflow 在本机提交作业", "Nextflow 在登录节点上提交作业") : executor.description}
        </span>
      </RadioGroup.Item>
    );
  };
  const chooseHost = (id: string) => {
    const next = remotes.find((candidate) => candidate.id === id);
    if (!next) {
      // Back on this machine: the local executor keeps its own managed work directory.
      onChange({ ...config, remote: undefined, workDir: config.executor === "local" ? "work" : config.workDir });
      return;
    }
    const executor = onHost(config.executor) ? config.executor : "local";
    onChange({
      ...config,
      remote: next.id,
      executor,
      settings: executor === config.executor ? config.settings : {},
      engine: executorDef(executor).engines.includes(config.engine) ? config.engine : "shell",
      workDir: config.remote ? config.workDir : "work",
    });
  };

  return (
    <div className="grid gap-6">
      {!real && (
        <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
          <Badge variant="warning" className="mt-0.5">预览</Badge>
          <span>模拟运行，不连接真实执行器</span>
        </p>
      )}
      {remotes.length > 0 && (
        <section className="grid gap-2">
          <Field
            label="从哪里启动 Nextflow"
            htmlFor={`${formId}-remote`}
            hint={host ? `SSH 到 ${host.host} 登录节点 · 工作区数据运行前自动同步过去` : "在这台电脑上启动"}
          >
            <Select value={config.remote ?? "here"} onValueChange={(value) => chooseHost(value === "here" ? "" : value)}>
              <SelectTrigger id={`${formId}-remote`} className="sm:w-80"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="here">这台电脑</SelectItem>
                {remotes.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>{candidate.name}（{candidate.user ? `${candidate.user}@` : ""}{candidate.host}）</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </section>
      )}
      <section className="grid gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground">
          {host ? "任务在哪里执行" : "运行在哪里"}
        </h3>
        <RadioGroup.Root
          className="grid gap-3"
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
          {executorOption(showExecutors ? executorDef("local") : def)}
          <div id={`${formId}-executors`} hidden={!showExecutors}>
            {showExecutors && (
              <div className="grid gap-3">
                {groups.filter(({ options }) => options.length > 0).map(({ label, options }) => (
                  <div key={label} role="group" aria-label={label} className="grid gap-2">
                    <h4 className="text-xs font-semibold text-muted-foreground">{label}</h4>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {options.map(executorOption)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </RadioGroup.Root>
        <Button type="button" variant="ghost" size="sm" className="justify-self-start" aria-expanded={showExecutors} aria-controls={`${formId}-executors`} onClick={() => setShowExecutors(!showExecutors)}>
          <ChevronDown className={cn(showExecutors && "rotate-180")} />
          {showExecutors ? "收起执行环境" : "更多执行环境"}
        </Button>
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
              isHostShell(config.engine)
                ? `不使用 -profile，进程在${host ? "集群节点" : "本机"}的 ${config.engine === "shell" ? "shell（/bin/bash）" : config.engine} 里直接执行`
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
                {def.engines.map((e) => (
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
          <Field label="工作目录（workDir）" htmlFor={`${formId}-workdir`} hint={host ? `填 work 时用 ${host.baseDir}/work` : undefined}>
            <Input
              id={`${formId}-workdir`}
              disabled={real && config.executor === "local" && !host}
              value={config.workDir}
              placeholder={host ? "work" : def.workDirHint}
              onChange={(e) => set({ workDir: e.target.value })}
              className="h-9 font-mono text-xs"
            />
          </Field>
          <Field
            label="额外 profile"
            htmlFor={`${formId}-profiles`}
            hint={
              real
                ? `支持 ${EXTRA_PROFILES.join("、")}；逗号分隔`
                : "逗号分隔，例如 debug,gpu"
            }
          >
            <Input
              id={`${formId}-profiles`}
              aria-describedby={`${formId}-profiles-hint`}
              value={config.extraProfiles.join(",")}
              placeholder="debug"
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
              {host
                ? "结果在运行结束后取回本机；"
                : config.executor === "local"
                  ? "本机工作目录自动隔离；"
                  : "集群和云上的工作目录需要计算节点也能访问；"}
              断点续跑请从运行详情选择来源记录。
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
