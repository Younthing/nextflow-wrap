"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Cloud, Loader2, Play, Server, Ship, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EDITOR_ACTIONS } from "@/features/editor/commands";
import { useEditorStore } from "@/features/editor/store";
import { useShortcutLabel } from "@/lib/use-action-shortcuts";
import { CodeViewer } from "@/features/project/components/code-viewer";
import { ProjectPreview } from "@/features/project/components/project-preview";
import { defaultProjectSettings, GenerateError, generateProject } from "@/features/project/generate";
import {
  defaultLaunchConfig,
  ENGINE_LABELS,
  EXECUTORS,
  executorDef,
  launchCommand,
  launchProblems,
  REGISTRIES,
  renderRunConfig,
  type ExecutorField,
  type ExecutorId,
  type LaunchConfig,
} from "@/features/project/launch";
import type { Issue } from "@/features/workflow/validate";
import { cn } from "@/lib/utils";
import { useHealthStatus, useLaunchRun } from "../queries";

const EXECUTOR_ICONS: Record<ExecutorId, React.ComponentType<{ className?: string }>> = {
  local: Server,
  slurm: Server,
  "google-batch": Cloud,
  "aws-batch": Cloud,
  "azure-batch": Cloud,
  k8s: Ship,
};

const launchKey = (docId: string) => `nf-studio-launch:${docId || "new"}`;

function readLaunchConfig(docId: string): LaunchConfig {
  try {
    const raw = localStorage.getItem(launchKey(docId));
    if (raw) return { ...defaultLaunchConfig(), ...(JSON.parse(raw) as Partial<LaunchConfig>), runName: undefined };
  } catch {
    // Fall through to defaults.
  }
  return defaultLaunchConfig();
}

function rememberLaunchConfig(docId: string, config: LaunchConfig) {
  try {
    localStorage.setItem(launchKey(docId), JSON.stringify({ ...config, runName: undefined }));
  } catch {
    // Non-essential.
  }
}

function Field({ label, htmlFor, children, hint }: { label: string; htmlFor?: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor} className="text-xs">
        {label}
      </Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
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
  const id = `exec-${field.key}`;
  if (field.type === "boolean") {
    return (
      <label className="flex h-9 items-center justify-between rounded-md border border-input px-3 text-sm">
        {field.label}
        <Switch checked={value === true} onCheckedChange={onChange} />
      </label>
    );
  }
  return (
    <Field label={`${field.label}${field.required ? " *" : ""}`} htmlFor={id} hint={field.help}>
      <Input
        id={id}
        type={field.type === "number" ? "number" : "text"}
        value={value === undefined ? "" : String(value)}
        placeholder={field.placeholder}
        onChange={(e) => onChange(field.type === "number" && e.target.value !== "" ? Number(e.target.value) : e.target.value)}
        className="h-9 font-mono text-xs"
      />
    </Field>
  );
}

function EnvironmentForm({ config, onChange, real }: { config: LaunchConfig; onChange: (c: LaunchConfig) => void; real?: boolean }) {
  const def = executorDef(config.executor);
  const set = (patch: Partial<LaunchConfig>) => onChange({ ...config, ...patch });

  return (
    <div className="grid gap-6">
      <section className="grid gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground">运行在哪里</h3>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-3" role="radiogroup" aria-label="执行器">
          {EXECUTORS.map((e) => {
            const Icon = EXECUTOR_ICONS[e.id];
            const active = e.id === config.executor;
            return (
              <button
                key={e.id}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={real && e.id !== "local"}
                onClick={() => {
                  if (active) return;
                  const engine = e.engines.includes(config.engine) ? config.engine : e.engines[0];
                  // Keep a custom work dir, but swap the previous executor's default for the new one.
                  const workDir = !config.workDir || config.workDir === def.workDirHint ? e.workDirHint : config.workDir;
                  set({ executor: e.id, engine, workDir, settings: {} });
                }}
                className={cn(
                  real && e.id !== "local" && "cursor-not-allowed opacity-40",
                  "flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors hover:bg-accent",
                  active ? "border-primary bg-primary/10 shadow-sm" : "border-border",
                )}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Icon className={cn("size-4", active ? "text-primary" : "text-muted-foreground")} />
                  {e.name}
                </span>
                <span className="text-[11px] leading-snug text-muted-foreground">{e.description}</span>
              </button>
            );
          })}
        </div>
      </section>

      {def.fields.length > 0 && (
        <section className="grid gap-3">
          <h3 className="text-xs font-semibold text-muted-foreground">{def.name} 设置</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {def.fields.map((f) => (
              <SettingInput
                key={f.key}
                field={f}
                value={config.settings[f.key]}
                onChange={(v) => set({ settings: { ...config.settings, [f.key]: v } })}
              />
            ))}
          </div>
        </section>
      )}

      <section className="grid gap-3">
        <h3 className="text-xs font-semibold text-muted-foreground">软件环境和存储</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="容器 / 环境（-profile）">
            <Select value={config.engine} onValueChange={(engine) => set({ engine: engine as LaunchConfig["engine"] })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {def.engines.filter((e) => !real || e === "docker").map((e) => (
                  <SelectItem key={e} value={e}>
                    {ENGINE_LABELS[e]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="镜像仓库">
            <Select value={config.registry} onValueChange={(registry) => set({ registry })}>
              <SelectTrigger>
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
          <Field label="工作目录（workDir）" htmlFor="workdir">
            <Input
              id="workdir"
              disabled={real}
              value={config.workDir}
              placeholder={def.workDirHint}
              onChange={(e) => set({ workDir: e.target.value })}
              className="h-9 font-mono text-xs"
            />
          </Field>
          <Field label="额外 profile" htmlFor="profiles" hint={real ? "支持 test、debug、emulate_amd64；逗号分隔" : "逗号分隔，例如 test,gpu"}>
            <Input
              id="profiles"
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
              onBlur={() => set({ extraProfiles: config.extraProfiles.filter(Boolean) })}
              className="h-9 font-mono text-xs"
            />
          </Field>
          <Field label="运行名称（-name）" htmlFor="run-name" hint="留空时自动生成">
            <Input
              id="run-name"
              value={config.runName ?? ""}
              placeholder="tender_curie"
              onChange={(e) => set({ runName: e.target.value.replace(/[^\w-]/g, "_") || undefined })}
              className="h-9 font-mono text-xs"
            />
          </Field>
          {real ? <p className="self-end text-xs text-muted-foreground">工作目录自动隔离；断点续跑请从运行详情选择来源记录。</p> : <label className="flex h-9 items-center justify-between self-end rounded-md border border-input px-3 text-sm">
            断点续跑（-resume）
            <Switch checked={config.resume} onCheckedChange={(resume) => set({ resume })} />
          </label>}
        </div>
      </section>
    </div>
  );
}

function ProjectSettingsForm() {
  const name = useEditorStore((s) => s.name);
  const stored = useEditorStore((s) => s.project);
  const setProject = useEditorStore((s) => s.setProject);
  const project = stored ?? defaultProjectSettings({ name });
  const set = (patch: Partial<typeof project>) => setProject({ ...project, ...patch });

  return (
    <section className="grid gap-3">
      <h3 className="text-xs font-semibold text-muted-foreground">项目信息（manifest）</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="项目名" htmlFor="proj-name">
          <Input
            id="proj-name"
            value={project.name}
            onChange={(e) => set({ name: e.target.value.replace(/[^\w/.-]/g, "") })}
            className="h-9 font-mono text-xs"
          />
        </Field>
        <Field label="版本" htmlFor="proj-version">
          <Input id="proj-version" value={project.version} onChange={(e) => set({ version: e.target.value })} className="h-9 font-mono text-xs" />
        </Field>
        <Field label="作者" htmlFor="proj-author">
          <Input id="proj-author" value={project.author} onChange={(e) => set({ author: e.target.value })} className="h-9 text-xs" />
        </Field>
      </div>
    </section>
  );
}

export function RunDialog({
  open,
  onOpenChange,
  issues,
  modulesSha,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issues: Issue[];
  modulesSha: string;
}) {
  const router = useRouter();
  const launch = useLaunchRun();
  const health = useHealthStatus(open);
  const real = !!health.data && !health.data.mocked;
  const docId = useEditorStore((s) => s.docId);
  const revision = useEditorStore((s) => s.revision);
  const saveShortcut = useShortcutLabel(EDITOR_ACTIONS.save.shortcut);
  const index = useEditorStore((s) => s.index);
  const [config, setConfig] = React.useState<LaunchConfig>(() => readLaunchConfig(docId));
  const launchConfig: LaunchConfig = real ? { ...config, settings: { cpus: 2, memory: "2.GB", ...config.settings }, executor: "local", engine: "docker", resume: false } : config;
  const [tab, setTab] = React.useState("environment");

  // Re-read the saved launch settings whenever the dialog opens for a workflow.
  const [openedFor, setOpenedFor] = React.useState<string | null>(null);
  if (open && openedFor !== docId) {
    setOpenedFor(docId);
    setConfig(readLaunchConfig(docId));
    setTab("environment");
  } else if (!open && openedFor !== null) {
    setOpenedFor(null);
  }

  const generated = React.useMemo(() => {
    if (!open || !index.size) return null;
    try {
      return { project: generateProject(useEditorStore.getState().toDoc(), index, { modulesSha, registry: config.registry }) };
    } catch (err) {
      if (err instanceof GenerateError) return { error: err.message };
      throw err;
    }
    // revision tracks every edit to the document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index, modulesSha, config.registry, revision]);

  const runConfig = renderRunConfig(launchConfig);
  const command = launchCommand(launchConfig);
  const errors = issues.filter((i) => i.level === "error").map((i) => i.message);
  const problems = [
    ...(docId ? [] : [`请先保存流程（${saveShortcut}）`]),
    ...(generated?.error ? [`无法生成项目：${generated.error}`] : []),
    ...errors,
    ...launchProblems(launchConfig),
    ...(real && !health.data?.runnerReady ? [health.data?.diagnostics ?? "Runner 未就绪"] : []),
  ];

  const start = () => {
    if (problems.length || !generated?.project) return;
    const doc = useEditorStore.getState().toDoc();
    const { project } = generated;
    rememberLaunchConfig(docId, launchConfig);
    launch.mutate(
      {
        workflow: doc,
        project: { name: project.meta.name, files: project.files.map(({ path, content }) => ({ path, content })), components: project.components },
        params: doc.params,
        launch: launchConfig,
        modulesSha,
        runConfig,
        command,
      },
      {
        onSuccess: (run) => {
          onOpenChange(false);
          router.push(`/runs/${run.id}`);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(860px,90vh)] flex-col gap-4 sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="font-serif">运行流程</DialogTitle>
          <DialogDescription>
            画布会生成一个 nf-core 结构的 Nextflow 项目，由后端用下面的命令启动。
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1">
          <TabsList>
            <TabsTrigger value="environment">运行环境</TabsTrigger>
            <TabsTrigger value="project">项目文件{generated?.project && ` · ${generated.project.files.length}`}</TabsTrigger>
            <TabsTrigger value="command">命令和配置</TabsTrigger>
          </TabsList>
          <TabsContent value="environment" className="min-h-0 overflow-auto pr-1">
            <div className="grid gap-6 py-1">
              <EnvironmentForm config={launchConfig} onChange={setConfig} real={real} />
              <ProjectSettingsForm />
            </div>
          </TabsContent>
          <TabsContent value="project" className="flex min-h-0 flex-col">
            {generated?.project ? (
              <ProjectPreview
                files={generated.project.files}
                components={generated.project.components}
                className="min-h-0 flex-1"
              />
            ) : (
              <div className="grid flex-1 place-items-center text-sm text-destructive">{generated?.error ?? "正在生成…"}</div>
            )}
          </TabsContent>
          <TabsContent value="command" className="grid min-h-0 content-start gap-4 overflow-auto">
            <div className="grid gap-1.5">
              <span className="text-xs font-semibold text-muted-foreground">启动命令（在项目目录中执行）</span>
              <CodeViewer code={command} language="text" lineNumbers={false} />
            </div>
            <div className="grid gap-1.5">
              <span className="text-xs font-semibold text-muted-foreground">run.config（-c）</span>
              <CodeViewer code={runConfig} language="groovy" />
            </div>
            <div className="grid gap-1.5">
              <span className="text-xs font-semibold text-muted-foreground">params.json（-params-file）</span>
              <CodeViewer code={JSON.stringify(useEditorStore.getState().params, null, 2)} language="json" />
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex items-end gap-4 border-t border-border/60 pt-4">
          <div className="min-w-0 flex-1 text-xs">
            {problems.length > 0 ? (
              <ul className="grid max-h-20 gap-1 overflow-auto">
                {problems.map((p) => (
                  <li key={p} className="flex items-start gap-1.5 text-destructive">
                    <XCircle className="mt-0.5 size-3.5 shrink-0" />
                    {p}
                  </li>
                ))}
              </ul>
            ) : launch.error ? (
              <span className="flex items-center gap-1.5 text-destructive">
                <AlertTriangle className="size-3.5" />
                启动失败：{launch.error.message}
              </span>
            ) : (
              <span className="font-mono text-muted-foreground">
                {executorDef(config.executor).name} · -profile {[config.engine, ...config.extraProfiles].join(",")}
              </span>
            )}
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={start} disabled={problems.length > 0 || launch.isPending}>
            {launch.isPending ? <Loader2 className="animate-spin" /> : <Play />}
            启动运行
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
