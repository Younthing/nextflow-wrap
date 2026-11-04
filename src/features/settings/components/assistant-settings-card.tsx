"use client";

import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import type { AssistantStatus } from "@/features/assistant/assistant-provider";
import { DEFAULT_COPILOT_MODEL } from "@/features/assistant/backend";
import { backendLabel, CLI_STATE_LABEL, cliState, type AssistantCli, type CliState } from "../assistant-status";
import { ASSISTANT_SECRET_KEYS, type AssistantBackend, type SecretKey, type SettingsView, type StudioSettings } from "../types";
import { SecretField } from "./secret-field";

const BACKENDS: { value: AssistantBackend; label: string; hint: string }[] = [
  { value: "auto", label: "自动（推荐）", hint: "依次使用已登录的本机 Codex、本机 Grok Build，都不可用时改用 API key" },
  { value: "codex", label: "本机 Codex", hint: "只用本机 Codex CLI，用它自己的登录，不读 API key" },
  { value: "grok", label: "本机 Grok Build", hint: "只用本机 Grok Build CLI，用它自己的登录，不读 API key" },
  { value: "builtin", label: "API key", hint: "不调用本机 CLI，按下方模型用对应厂商的 API key" },
];

const ASSISTANT_ENV_KEYS: string[] = ["COPILOT_BACKEND", "COPILOT_MODEL", "CODEX_MODEL", "GROK_MODEL", ...ASSISTANT_SECRET_KEYS];

const CLI: Record<AssistantCli, { name: string; login: string }> = {
  codex: { name: "Codex", login: "codex login" },
  grok: { name: "Grok Build", login: "grok login" },
};

const CLI_BADGE: Record<CliState, "success" | "warning" | "destructive" | "secondary"> = {
  ready: "success",
  unauthenticated: "warning",
  unavailable: "warning",
  "not-installed": "secondary",
  unchecked: "secondary",
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

/** Read-only: what the server resolved from the saved settings. */
function StatusPanel({ status, loading, onRefresh, pending, envKeys, clis }: { status?: AssistantStatus; loading?: boolean; onRefresh?: () => void; pending: boolean; envKeys: string[]; clis: AssistantCli[] }) {
  return (
    <div role="status" aria-live="polite" className="grid gap-2 rounded-lg border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        {!status ? (
          <Badge variant="secondary">{loading ? "检测中…" : "未知"}</Badge>
        ) : status.enabled ? (
          <Badge variant="success">可用</Badge>
        ) : (
          <Badge variant="destructive">未启用</Badge>
        )}
        <span className="min-w-0 flex-1 text-sm">
          {status?.enabled ? `当前使用 ${backendLabel(status.backend)}` : (status?.message ?? "正在读取助手状态")}
        </span>
        {onRefresh && (
          <Button type="button" size="sm" variant="ghost" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={loading ? "animate-spin" : undefined} />重新检测
          </Button>
        )}
      </div>
      {status && (
        <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_1fr] sm:items-center">
          {status.enabled && (
            <>
              <dt className="text-muted-foreground">模型</dt>
              <dd className="font-mono">{status.model ?? "CLI 默认"}</dd>
            </>
          )}
          {clis.map((cli) => {
            const state = cliState(status, cli);
            return (
              <div key={cli} className="contents">
                <dt className="text-muted-foreground">{CLI[cli].name} CLI</dt>
                <dd className="flex flex-wrap items-center gap-2">
                  <Badge variant={CLI_BADGE[state]}>{CLI_STATE_LABEL[state]}</Badge>
                  {state === "unauthenticated" && <span className="text-muted-foreground">在终端运行 <code className="font-mono">{CLI[cli].login}</code></span>}
                  {state === "not-installed" && <span className="text-muted-foreground">本机没有找到 {cli} 命令</span>}
                </dd>
              </div>
            );
          })}
          {status.missing && (
            <>
              <dt className="text-muted-foreground">缺少</dt>
              <dd className="font-mono">{status.missing}</dd>
            </>
          )}
        </dl>
      )}
      {envKeys.length > 0 && <p className="text-[11px] text-muted-foreground">环境变量 <span className="font-mono">{envKeys.join("、")}</span> 优先于这里的设置</p>}
      {pending && <p className="text-[11px] text-warning">状态按已保存的设置检测，保存后重新检测</p>}
    </div>
  );
}

/**
 * AI 助手 settings: status → backend → the fields that backend uses → API keys.
 * Saving still goes through the surrounding SettingsForm.
 */
export function AssistantSettingsCard({
  value,
  saved,
  view,
  secrets,
  status,
  statusLoading,
  onRefreshStatus,
  overridden,
  onChange,
  onSecretChange,
}: {
  value: StudioSettings["assistant"];
  /** Last saved settings: the status reflects these, not the draft. */
  saved: StudioSettings["assistant"];
  view: SettingsView;
  secrets: Partial<Record<SecretKey, string | null>>;
  status?: AssistantStatus;
  statusLoading?: boolean;
  onRefreshStatus?: () => void;
  overridden: (key: string) => string | undefined;
  onChange: (patch: Partial<StudioSettings["assistant"]>) => void;
  onSecretChange: (key: SecretKey, value: string | null) => void;
}) {
  const backend = value.backend;
  const usesCli = (cli: AssistantCli) => backend === "auto" || backend === cli;
  const usesApi = backend === "auto" || backend === "builtin";
  const selected = BACKENDS.find((option) => option.value === backend);
  const pending = JSON.stringify(value) !== JSON.stringify(saved) || ASSISTANT_SECRET_KEYS.some((key) => key in secrets);

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI 助手</CardTitle>
        <CardDescription>选择助手用哪个后端，以及各后端的模型和凭据</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <StatusPanel status={status} loading={statusLoading} onRefresh={onRefreshStatus} pending={pending} clis={(["codex", "grok"] as const).filter((cli) => saved.backend === "auto" || saved.backend === cli)} envKeys={view.environmentOverrides.filter((key) => ASSISTANT_ENV_KEYS.includes(key))} />

        <Section title="后端">
          <FormField label="使用" htmlFor="assistant-backend" hint={overridden("COPILOT_BACKEND") ?? selected?.hint}>
            <Select value={backend} onValueChange={(next) => onChange({ backend: next as AssistantBackend })}>
              <SelectTrigger id="assistant-backend" className="h-8 text-xs sm:w-64"><SelectValue /></SelectTrigger>
              <SelectContent>
                {BACKENDS.map((option) => <SelectItem key={option.value} value={option.value} className="text-xs">{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </FormField>
        </Section>

        {(usesCli("codex") || usesCli("grok")) && (
          <>
            <Separator />
            <Section title="本机 CLI">
              <div className="grid gap-4 sm:grid-cols-2">
                {usesCli("codex") && (
                  <FormField label="Codex 模型" htmlFor="codex-model" hint={overridden("CODEX_MODEL") ?? "留空用 Codex 默认模型"}>
                    <Input id="codex-model" className="h-8 font-mono text-xs" placeholder="默认" value={value.codexModel ?? ""} onChange={(event) => onChange({ codexModel: event.target.value || undefined })} />
                  </FormField>
                )}
                {usesCli("grok") && (
                  <FormField label="Grok 模型" htmlFor="grok-model" hint={overridden("GROK_MODEL") ?? "留空用 Grok Build 默认模型"}>
                    <Input id="grok-model" className="h-8 font-mono text-xs" placeholder="默认" value={value.grokModel ?? ""} onChange={(event) => onChange({ grokModel: event.target.value || undefined })} />
                  </FormField>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                CLI 用它自己的登录，不能在这里完成：在终端运行{" "}
                {(["codex", "grok"] as const).filter(usesCli).map((cli, index) => (
                  <span key={cli}>{index > 0 && " 或 "}<code className="font-mono">{CLI[cli].login}</code></span>
                ))}
                ，然后点「重新检测」。
              </p>
            </Section>
          </>
        )}

        {usesApi && (
          <>
            <Separator />
            <Section title={backend === "auto" ? "API key 后端（本机 CLI 都不可用时）" : "API key 后端"}>
              <FormField label="模型" htmlFor="assistant-model" hint={overridden("COPILOT_MODEL") ?? "provider/model，按 provider 读取下方对应的 key"}>
                <Input id="assistant-model" className="h-8 font-mono text-xs sm:w-80" placeholder={DEFAULT_COPILOT_MODEL} value={value.model ?? ""} onChange={(event) => onChange({ model: event.target.value || undefined })} />
              </FormField>
              <div className="grid gap-4 sm:grid-cols-3">
                {ASSISTANT_SECRET_KEYS.map((key) => (
                  <SecretField key={key} name={key} saved={view.secrets[key]} value={secrets[key]} hint={overridden(key)} onChange={(next) => onSecretChange(key, next)} />
                ))}
              </div>
            </Section>
          </>
        )}
      </CardContent>
    </Card>
  );
}
