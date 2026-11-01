"use client";

import * as React from "react";
import { KeyRound, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PathInput } from "@/features/files/components/path-input";
import { ENGINES, type ContainerEngine } from "@/features/project/launch";
import { SECRET_KEYS, type SecretKey, type SettingsUpdate, type SettingsView, type StudioSettings } from "../types";

const ENGINE_LABEL: Partial<Record<ContainerEngine, string>> = { shell: "本机 shell（不加 profile）" };
const SECRET_LABEL: Record<SecretKey, string> = { ANTHROPIC_API_KEY: "Anthropic API key", OPENAI_API_KEY: "OpenAI API key", GOOGLE_API_KEY: "Google API key" };

/** Runtime defaults, notifications and the AI assistant. API keys are write-only: the page only knows if one is set. */
export function SettingsForm({ view, onSave, saving }: { view: SettingsView; onSave: (update: SettingsUpdate) => void; saving?: boolean }) {
  const [draft, setDraft] = React.useState<StudioSettings>(view.settings);
  const [secrets, setSecrets] = React.useState<Partial<Record<SecretKey, string | null>>>({});
  const runtime = (patch: Partial<StudioSettings["runtime"]>) => setDraft((current) => ({ ...current, runtime: { ...current.runtime, ...patch } }));
  const assistant = (patch: Partial<StudioSettings["assistant"]>) => setDraft((current) => ({ ...current, assistant: { ...current.assistant, ...patch } }));
  const overridden = (key: string) => view.environmentOverrides.includes(key) ? `环境变量 ${key} 已设置，以它为准` : undefined;
  const dirty = JSON.stringify(draft) !== JSON.stringify(view.settings) || Object.keys(secrets).length > 0;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => { event.preventDefault(); onSave({ settings: draft, ...(Object.keys(secrets).length ? { secrets } : {}) }); }}
    >
      <Card>
        <CardHeader>
          <CardTitle>新运行的默认值</CardTitle>
          <CardDescription>还没有保存过运行设置的流程用这些值；每个流程在运行对话框里改过之后记住自己的设置。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <FormField label="运行时（-profile）" htmlFor="default-engine">
            <Select value={draft.runtime.defaultEngine} onValueChange={(value) => runtime({ defaultEngine: value as ContainerEngine })}>
              <SelectTrigger id="default-engine" className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ENGINES.map((engine) => <SelectItem key={engine} value={engine} className="text-xs">{ENGINE_LABEL[engine] ?? engine}</SelectItem>)}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="本机最多 CPU" htmlFor="default-cpus">
            <Input id="default-cpus" type="number" min={1} className="h-8 font-mono text-xs" value={draft.runtime.cpus ?? ""} placeholder="2" onChange={(event) => runtime({ cpus: event.target.value ? Number(event.target.value) : undefined })} />
          </FormField>
          <FormField label="本机最多内存" htmlFor="default-memory">
            <Input id="default-memory" className="h-8 font-mono text-xs" value={draft.runtime.memory ?? ""} placeholder="2.GB" onChange={(event) => runtime({ memory: event.target.value || undefined })} />
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>工具位置</CardTitle>
          <CardDescription>留空时自动查找：先找系统里已装的，再用设置向导装到数据目录的版本。Runner 重启后生效。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField label="Java（JAVA_HOME）" htmlFor="java-home" hint={overridden("NEXTFLOW_JAVA_HOME")}>
            <PathInput id="java-home" kind="directory" className="h-8 text-xs" value={draft.runtime.javaHome ?? ""} onChange={(value) => runtime({ javaHome: value || undefined })} />
          </FormField>
          <FormField label="Nextflow 可执行文件" htmlFor="nextflow-bin" hint={overridden("NEXTFLOW_BIN")}>
            <PathInput id="nextflow-bin" className="h-8 text-xs" value={draft.runtime.nextflowBin ?? ""} onChange={(value) => runtime({ nextflowBin: value || undefined })} />
          </FormField>
          <FormField label="笔记本用的 Python（装有 jupyter_client）" htmlFor="jupyter-python" hint={overridden("NEXTFLOW_STUDIO_JUPYTER_PYTHON")}>
            <PathInput id="jupyter-python" className="h-8 text-xs" value={draft.runtime.jupyterPython ?? ""} onChange={(value) => runtime({ jupyterPython: value || undefined })} />
          </FormField>
          <FormField label="HTTP 代理" htmlFor="http-proxy" hint={overridden("NEXTFLOW_HTTP_PROXY") ?? "Nextflow 下载插件、容器和 conda 包时使用"}>
            <Input id="http-proxy" className="h-8 font-mono text-xs" placeholder="http://127.0.0.1:7890" value={draft.runtime.httpProxy ?? ""} onChange={(event) => runtime({ httpProxy: event.target.value || undefined })} />
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>通知</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Switch id="notify-finished" checked={draft.notifications.runFinished} onCheckedChange={(checked) => setDraft((current) => ({ ...current, notifications: { runFinished: checked } }))} />
            <Label htmlFor="notify-finished" className="text-sm">运行完成或失败时发系统通知</Label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI 助手</CardTitle>
          <CardDescription>
            自动模式优先用本机已 <code className="font-mono">codex login</code> 的 Codex；不可用时用下面的 API key。
            {view.secretStorage === "keychain" ? "API key 用系统钥匙串保护的密钥加密保存。" : "API key 保存在只有当前用户可读的文件里。"}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <FormField label="后端" htmlFor="assistant-backend" hint={overridden("COPILOT_BACKEND")}>
            <Select value={draft.assistant.backend} onValueChange={(value) => assistant({ backend: value as StudioSettings["assistant"]["backend"] })}>
              <SelectTrigger id="assistant-backend" className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto" className="text-xs">自动</SelectItem>
                <SelectItem value="codex" className="text-xs">只用 Codex</SelectItem>
                <SelectItem value="builtin" className="text-xs">只用 API key</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="模型（API key 后端）" htmlFor="assistant-model" hint={overridden("COPILOT_MODEL")}>
            <Input id="assistant-model" className="h-8 font-mono text-xs" placeholder="anthropic/claude-sonnet-5-5" value={draft.assistant.model ?? ""} onChange={(event) => assistant({ model: event.target.value || undefined })} />
          </FormField>
          <FormField label="Codex 模型" htmlFor="codex-model" hint={overridden("CODEX_MODEL")}>
            <Input id="codex-model" className="h-8 font-mono text-xs" placeholder="默认" value={draft.assistant.codexModel ?? ""} onChange={(event) => assistant({ codexModel: event.target.value || undefined })} />
          </FormField>
          {SECRET_KEYS.map((key) => (
            <FormField key={key} label={SECRET_LABEL[key]} htmlFor={key} hint={overridden(key) ?? (view.secrets[key] && secrets[key] === undefined ? "已保存" : undefined)}>
              <div className="flex items-center gap-1">
                <KeyRound className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <Input
                  id={key}
                  type="password"
                  autoComplete="off"
                  className="h-8 font-mono text-xs"
                  placeholder={view.secrets[key] ? "••••••••（输入新值替换）" : "未设置"}
                  value={typeof secrets[key] === "string" ? secrets[key] : ""}
                  onChange={(event) => setSecrets((current) => ({ ...current, [key]: event.target.value }))}
                />
                {view.secrets[key] && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setSecrets((current) => ({ ...current, [key]: null }))}>清除</Button>
                )}
              </div>
            </FormField>
          ))}
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!dirty || saving}><Save />保存设置</Button>
        {view.runnerRestartNeeded && <span role="status" className="text-xs text-warning">工具位置已更改，重启 runner（桌面版重启应用）后生效</span>}
      </div>
    </form>
  );
}
