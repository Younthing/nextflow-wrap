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
import { isDesktop } from "@/lib/desktop";
import { ENGINES, type ContainerEngine } from "@/features/project/launch";
import { ASSISTANT_SECRET_KEYS, type SecretKey, type SettingsUpdate, type SettingsView, type StudioSettings } from "../types";

const ENGINE_LABEL: Partial<Record<ContainerEngine, string>> = { shell: "本机 shell（不加 profile）" };
/** A browser shows run notifications only after the user allows them; the desktop shell needs no permission. */
function askNotificationPermission() {
  if (isDesktop() || typeof Notification === "undefined" || Notification.permission !== "default") return;
  void Notification.requestPermission();
}

const SECRET_LABEL: Record<SecretKey, string> = {
  ANTHROPIC_API_KEY: "Anthropic API key",
  OPENAI_API_KEY: "OpenAI API key",
  GOOGLE_API_KEY: "Google API key",
  AWS_ACCESS_KEY_ID: "AWS Access Key ID",
  AWS_SECRET_ACCESS_KEY: "AWS Secret Access Key",
  AZURE_BATCH_ACCOUNT_KEY: "Azure Batch 账户密钥",
  AZURE_STORAGE_ACCOUNT_KEY: "Azure 存储账户密钥",
};

/** A write-only secret: the page only knows whether one is saved; typing replaces it, 清除 removes it. */
function SecretField({ name, saved, value, hint, onChange }: { name: SecretKey; saved: boolean; value: string | null | undefined; hint?: string; onChange: (value: string | null) => void }) {
  return (
    <FormField label={SECRET_LABEL[name]} htmlFor={name} hint={hint ?? (saved && value === undefined ? "已保存" : value === null ? "保存后清除" : undefined)}>
      <div className="flex items-center gap-1">
        <KeyRound className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Input
          id={name}
          type="password"
          autoComplete="off"
          className="h-8 font-mono text-xs"
          placeholder={saved ? "••••••••（输入新值替换）" : "未设置"}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
        />
        {saved && <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>清除</Button>}
      </div>
    </FormField>
  );
}

/** Runtime defaults, notifications and the AI assistant. API keys are write-only: the page only knows if one is set. */
export function SettingsForm({ view, onSave, saving }: { view: SettingsView; onSave: (update: SettingsUpdate) => void; saving?: boolean }) {
  const [draft, setDraft] = React.useState<StudioSettings>(view.settings);
  const [secrets, setSecrets] = React.useState<Partial<Record<SecretKey, string | null>>>({});
  const runtime = (patch: Partial<StudioSettings["runtime"]>) => setDraft((current) => ({ ...current, runtime: { ...current.runtime, ...patch } }));
  const cloud = (patch: Partial<StudioSettings["cloud"]>) => setDraft((current) => ({ ...current, cloud: { ...current.cloud, ...patch } }));
  const assistant = (patch: Partial<StudioSettings["assistant"]>) => setDraft((current) => ({ ...current, assistant: { ...current.assistant, ...patch } }));
  const overridden = (key: string) => view.environmentOverrides.includes(key) ? `由环境变量 ${key} 覆盖` : undefined;
  const dirty = JSON.stringify(draft) !== JSON.stringify(view.settings) || Object.keys(secrets).length > 0;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => { event.preventDefault(); onSave({ settings: draft, ...(Object.keys(secrets).length ? { secrets } : {}) }); }}
    >
      <Card>
        <CardHeader>
          <CardTitle>新运行的默认值</CardTitle>
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
          <CardDescription>留空则自动查找 · 重启 Runner 后生效</CardDescription>
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
          <FormField label="HTTP 代理" htmlFor="http-proxy" hint={overridden("NEXTFLOW_HTTP_PROXY")}>
            <Input id="http-proxy" className="h-8 font-mono text-xs" placeholder="http://127.0.0.1:7890" value={draft.runtime.httpProxy ?? ""} onChange={(event) => runtime({ httpProxy: event.target.value || undefined })} />
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>通知</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Switch id="notify-finished" checked={draft.notifications.runFinished} onCheckedChange={(checked) => { setDraft((current) => ({ ...current, notifications: { runFinished: checked } })); if (checked) askNotificationPermission(); }} />
            <Label htmlFor="notify-finished" className="text-sm">运行完成或失败时发系统通知</Label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI 助手</CardTitle>
          <CardDescription>
            自动：优先 Codex（<code className="font-mono">codex login</code>），否则 API key
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
          {ASSISTANT_SECRET_KEYS.map((key) => (
            <SecretField key={key} name={key} saved={view.secrets[key]} value={secrets[key]} hint={overridden(key)} onChange={(value) => setSecrets((current) => ({ ...current, [key]: value }))} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>云端凭据</CardTitle>
          <CardDescription>
            用于 AWS / Google / Azure Batch · 已配置 CLI 可留空 · 重启 Runner 后生效
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField label="AWS profile" htmlFor="aws-profile" hint={overridden("AWS_PROFILE") ?? "~/.aws/config 里的配置名"}>
            <Input id="aws-profile" className="h-8 font-mono text-xs" placeholder="default" value={draft.cloud.awsProfile ?? ""} onChange={(event) => cloud({ awsProfile: event.target.value || undefined })} />
          </FormField>
          <FormField label="AWS 区域" htmlFor="aws-region" hint={overridden("AWS_REGION")}>
            <Input id="aws-region" className="h-8 font-mono text-xs" placeholder="us-east-1" value={draft.cloud.awsRegion ?? ""} onChange={(event) => cloud({ awsRegion: event.target.value || undefined })} />
          </FormField>
          {(["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"] as const).map((key) => (
            <SecretField key={key} name={key} saved={view.secrets[key]} value={secrets[key]} hint={overridden(key)} onChange={(value) => setSecrets((current) => ({ ...current, [key]: value }))} />
          ))}
          <FormField label="Google 服务账号 JSON" htmlFor="google-credentials" hint={overridden("GOOGLE_APPLICATION_CREDENTIALS") ?? "留空用 gcloud 默认凭据"}>
            <PathInput id="google-credentials" className="h-8 text-xs" value={draft.cloud.googleCredentials ?? ""} onChange={(value) => cloud({ googleCredentials: value || undefined })} />
          </FormField>
          <div className="hidden sm:block" />
          <FormField label="Azure Batch 账户名" htmlFor="azure-batch-account" hint={overridden("AZURE_BATCH_ACCOUNT_NAME")}>
            <Input id="azure-batch-account" className="h-8 font-mono text-xs" value={draft.cloud.azureBatchAccount ?? ""} onChange={(event) => cloud({ azureBatchAccount: event.target.value || undefined })} />
          </FormField>
          <SecretField name="AZURE_BATCH_ACCOUNT_KEY" saved={view.secrets.AZURE_BATCH_ACCOUNT_KEY} value={secrets.AZURE_BATCH_ACCOUNT_KEY} hint={overridden("AZURE_BATCH_ACCOUNT_KEY")} onChange={(value) => setSecrets((current) => ({ ...current, AZURE_BATCH_ACCOUNT_KEY: value }))} />
          <FormField label="Azure 存储账户名" htmlFor="azure-storage-account" hint={overridden("AZURE_STORAGE_ACCOUNT_NAME")}>
            <Input id="azure-storage-account" className="h-8 font-mono text-xs" value={draft.cloud.azureStorageAccount ?? ""} onChange={(event) => cloud({ azureStorageAccount: event.target.value || undefined })} />
          </FormField>
          <SecretField name="AZURE_STORAGE_ACCOUNT_KEY" saved={view.secrets.AZURE_STORAGE_ACCOUNT_KEY} value={secrets.AZURE_STORAGE_ACCOUNT_KEY} hint={overridden("AZURE_STORAGE_ACCOUNT_KEY")} onChange={(value) => setSecrets((current) => ({ ...current, AZURE_STORAGE_ACCOUNT_KEY: value }))} />
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!dirty || saving}><Save />保存设置</Button>
        {view.runnerRestartNeeded && <span role="status" className="text-xs text-warning">重启 Runner 后生效</span>}
      </div>
    </form>
  );
}
