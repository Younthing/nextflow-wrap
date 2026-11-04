"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { AsyncPlaceholder } from "@/components/ui/async-placeholder";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { EnvConfigAssistant, PublishAssistant } from "@/features/assistant/surfaces/prompt-only";
import { convertNotebook, ConvertError, inputPorts, outputPorts } from "@/features/notebook/convert";
import { missingEnvLabels, sameModuleEnv, stageModuleEnv, tryRunEnvSummary } from "@/features/notebook/env";
import { defaultInputDraft, SOURCE_LABEL, type InputDraft } from "@/features/notebook/input-bindings";
import { useNotebook, usePublishNotebook, useScriptModules, useTryRunNotebook } from "@/features/notebook/queries";
import type { TryRunRecord } from "@/features/notebook/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { versionNumber } from "@/features/workflow/origin";
import { ModuleEnvFields, ModuleEnvPreview } from "./module-env-form";
import { bindingsFromDrafts, TryRunBindingTable, TryRunInputs } from "./try-run-inputs";

const NEW_MODULE = "__new__";

export function PublishWizard({ notebookId }: { notebookId: string }) {
  return (
    <>
      <PublishAssistant />
      <EnvConfigAssistant />
      <PublishWizardScreen notebookId={notebookId} />
    </>
  );
}

function Section({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: (open: boolean) => void; children: React.ReactNode }) {
  return (
    <details
      open={open}
      onToggle={(event) => onToggle(event.currentTarget.open)}
      className="rounded-lg border border-border"
    >
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold">{title}</summary>
      <div className="space-y-3 border-t border-border p-3">{children}</div>
    </details>
  );
}

/**
 * One page: the module form, with the conversion preview and the try-run inputs and environment folded below.
 * Saving runs the draft module through `nextflow module run` first and publishes only when that passes;
 * a failure keeps the page and shows the Nextflow log.
 */
function PublishWizardScreen({ notebookId }: { notebookId: string }) {
  const router = useRouter();
  const notebook = useNotebook(notebookId);
  const scripts = useScriptModules();
  const tryRun = useTryRunNotebook();
  const publish = usePublishNotebook();
  const [drafts, setDrafts] = React.useState<Record<string, InputDraft>>({});
  const [seededFor, setSeededFor] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  /** Module to overwrite, or NEW_MODULE. */
  const [target, setTarget] = React.useState(NEW_MODULE);
  const [description, setDescription] = React.useState("");
  const [changelog, setChangelog] = React.useState("");
  const [condaYaml, setCondaYaml] = React.useState("");
  const [containerImage, setContainerImage] = React.useState("");
  const [namedFor, setNamedFor] = React.useState<string | null>(null);
  const [envFor, setEnvFor] = React.useState<string | null>(null);
  const [inputsOpen, setInputsOpen] = React.useState(false);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  /** The inputs the last try-run used; edited inputs need a new run before saving. */
  const [ranWith, setRanWith] = React.useState<string | null>(null);

  const doc = notebook.data;
  const converted = React.useMemo(() => {
    if (!doc) return null;
    try {
      return { ok: true as const, value: convertNotebook(doc) };
    } catch (error) {
      return { ok: false as const, message: error instanceof ConvertError || error instanceof Error ? error.message : "无法转化" };
    }
  }, [doc]);

  const seedKey = doc && converted?.ok ? `${doc.id}:${doc.rev}` : null;
  if (seedKey && seededFor !== seedKey && converted?.ok) {
    const next: Record<string, InputDraft> = {};
    for (const input of converted.value.inputs) next[input.name] = defaultInputDraft(input);
    setDrafts(next);
    setSeededFor(seedKey);
    // A required input with nothing to fill it in: show the inputs instead of failing the first save.
    if (converted.value.inputs.some((input) => input.required && input.defaultValue === undefined && next[input.name]?.source === "path" && !next[input.name]?.path)) {
      setInputsOpen(true);
    }
  }
  if (converted && !converted.ok && !previewOpen) setPreviewOpen(true);

  if (doc && namedFor !== doc.id) {
    setNamedFor(doc.id);
    setName(doc.name.replace(/\s+/g, "_"));
    setDescription(doc.description);
  }

  // A notebook opened to edit a module overwrites that module by default, with its environment.
  if (doc && scripts.isSuccess && envFor !== doc.id) {
    const from = scripts.data.modules.find((mod) => mod.id === doc.fromModuleId);
    setEnvFor(doc.id);
    if (from) {
      setTarget(from.id);
      setName(from.name);
      if (!condaYaml && from.condaYaml) setCondaYaml(from.condaYaml);
      if (!containerImage && from.containerImage) setContainerImage(from.containerImage);
    }
  }

  const overwriting = scripts.data?.modules.find((mod) => mod.id === target);
  const version = overwriting ? `v${versionNumber(overwriting.version) + 1}` : "v1";
  const receipt = tryRun.data;
  const staged = stageModuleEnv({ condaYaml, containerImage });
  const envAligned = staged.ok && !!receipt && sameModuleEnv(receipt, staged);
  const bindings = converted?.ok ? bindingsFromDrafts(converted.value.inputs, drafts) : [];
  const inputsAligned = ranWith === JSON.stringify(bindings);
  const passed = staged.ok && !!receipt?.passed && receipt.rev === doc?.rev && envAligned && inputsAligned;
  const envChanged = staged.ok && !!receipt?.passed && receipt.rev === doc?.rev && !envAligned;
  const logMark = !receipt ? "" : passed ? "· 通过" : envChanged || (receipt.passed && !inputsAligned) ? "· 需重跑" : "· 失败";
  const busy = tryRun.isPending || publish.isPending;
  const canConvert = !!converted?.ok && converted.value.outputs.length > 0;

  if (notebook.isPending) return <AsyncPlaceholder status="pending" className="h-full" />;
  if (notebook.error || !doc) return <AsyncPlaceholder status="error" className="h-auto" message={notebook.error?.message ?? "笔记本不存在"} />;

  const runTry = (then?: (record: TryRunRecord) => void) => {
    if (!staged.ok || !converted?.ok) return;
    publish.reset();
    setRanWith(JSON.stringify(bindings));
    tryRun.mutate(
      {
        id: doc.id,
        bindings,
        condaYaml: staged.condaYaml,
        containerImage: staged.containerImage,
      },
      { onSuccess: (record) => then?.(record) },
    );
  };
  const save = () => {
    const send = () => publish.mutate(
      { id: doc.id, name: name.trim(), overwrite: overwriting?.id, description, changelog, condaYaml, containerImage },
      { onSuccess: () => router.push("/modules") },
    );
    if (passed) {
      send();
      return;
    }
    runTry((record) => {
      if (record.passed) send();
    });
  };
  const saveLabel = overwriting ? `覆盖 ${overwriting.name} → ${version}` : "新建模块";

  return (
    <div className="flex size-full min-h-0 flex-col gap-3">
      <header className="glass flex flex-wrap items-center gap-3 rounded-xl px-4 py-3">
        <div className="text-xs text-muted-foreground">
          <Link href={`/workbench/${notebookId}`} className="hover:underline">笔记本 / {doc.name}</Link>
          <span> / 导出为模块</span>
        </div>
        <Button asChild variant="ghost" size="sm" className="ml-auto">
          <Link href={`/workbench/${notebookId}`}>取消，回笔记本</Link>
        </Button>
      </header>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-2">
        <section className="glass min-h-0 space-y-3 overflow-auto rounded-xl p-4">
          <h2 className="text-sm font-semibold">模块信息</h2>
          <FormField label="导出到" htmlFor="module-target">
            <Select
              value={target}
              onValueChange={(next) => {
                setTarget(next);
                const mod = scripts.data?.modules.find((item) => item.id === next);
                if (mod) setName(mod.name);
              }}
            >
              <SelectTrigger id="module-target" className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NEW_MODULE} className="text-xs">新模块</SelectItem>
                {(scripts.data?.modules ?? []).map((mod) => (
                  <SelectItem key={mod.id} value={mod.id} className="text-xs">
                    覆盖 <span className="font-mono">{mod.name}</span> {mod.version}{mod.referenceCount ? ` · ${mod.referenceCount} 个流程在用` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="模块名" htmlFor="module-name">
            <Input id="module-name" value={name} onChange={(event) => setName(event.target.value)} className="h-8 font-mono text-xs" />
          </FormField>
          <FormField label="说明" htmlFor="module-description">
            <Input id="module-description" value={description} onChange={(event) => setDescription(event.target.value)} className="h-8 text-xs" />
          </FormField>
          <FormField label="版本" htmlFor="module-version">
            <Input id="module-version" value={overwriting ? `${overwriting.version ?? "v1"} → ${version}` : version} readOnly className="h-8 font-mono text-xs" />
          </FormField>
          <FormField label="更新说明" htmlFor="module-changelog">
            <Input id="module-changelog" value={changelog} onChange={(event) => setChangelog(event.target.value)} className="h-8 text-xs" />
          </FormField>
          <ModuleEnvFields
            idPrefix="publish-env"
            condaYaml={condaYaml}
            containerImage={containerImage}
            onCondaYaml={setCondaYaml}
            onContainerImage={setContainerImage}
          />
          {staged.ok ? (
            <p className="text-xs text-muted-foreground" role={missingEnvLabels(staged).length ? "status" : undefined}>
              {tryRunEnvSummary(staged)}
            </p>
          ) : (
            <p role="alert" className="text-xs text-destructive">{staged.message}</p>
          )}

          {converted?.ok && (
            <Section title="试跑输入" open={inputsOpen} onToggle={setInputsOpen}>
              <p className="text-xs text-muted-foreground">相对路径（如 data/sample.csv）从项目文件夹读取。保存前用 Nextflow 模块测试跑一遍。</p>
              <TryRunInputs
                inputs={converted.value.inputs}
                drafts={drafts}
                onChange={(port, draft) => setDrafts((current) => ({ ...current, [port]: draft }))}
              />
              <Button type="button" variant="outline" size="sm" disabled={busy || !staged.ok} onClick={() => runTry()}>
                {tryRun.isPending ? <Loader2 className="animate-spin" /> : null}
                {receipt ? "重新试跑" : "只试跑"}
              </Button>
            </Section>
          )}

          <Section title="转化预览" open={previewOpen} onToggle={setPreviewOpen}>
            {converted?.ok ? (
              <>
                <pre className="overflow-auto rounded-lg bg-secondary/60 p-3 font-mono text-xs">{converted.value.commandPreview}</pre>
                <h3 className="text-sm font-semibold">{converted.value.entry.split("/").pop()}</h3>
                <pre className="max-h-80 overflow-auto rounded-lg bg-secondary/60 p-3 font-mono text-xs">{converted.value.script}</pre>
                <ul className="grid gap-1 font-mono text-xs">
                  {inputPorts(converted.value.inputs).map((port) => (
                    <li key={`in-${port.name}`}>入 · {port.name}{port.description === "文件列表" ? "[]" : ""}</li>
                  ))}
                  {outputPorts(converted.value.outputs).map((port) => (
                    <li key={`out-${port.name}`}>出 · {port.name}</li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  包含单元格 {converted.value.included.map((cell) => `[${cell.index}]`).join(" ") || "无"}
                  <br />
                  排除 {converted.value.excluded.map((cell) => `[${cell.index}] ${cell.role === "explore" ? "自由探索" : "说明"}`).join("、") || "无"}
                </p>
              </>
            ) : (
              <p className="text-sm text-destructive">{converted?.message}</p>
            )}
          </Section>
        </section>

        <section className="glass flex min-h-0 flex-col gap-3 overflow-auto rounded-xl p-4 text-sm">
          <h2 className="font-semibold">将写入模块库</h2>
          <p>命令行 <span className="font-mono">{converted?.ok ? converted.value.entry : "—"}</span></p>
          <p>端口 {converted?.ok ? `${converted.value.inputs.length} 输入 · ${converted.value.outputs.length} 输出` : "—"}</p>
          {converted?.ok && converted.value.outputs.length === 0 && <p className="text-destructive">至少标一个输出端口才能发布</p>}
          <ModuleEnvPreview condaYaml={condaYaml} containerImage={containerImage} />
          <p className={passed ? "text-success" : receipt ? "text-destructive" : "text-muted-foreground"}>
            {tryRun.isPending
              ? "Nextflow 模块测试运行中…"
              : passed
                ? `试跑通过 · ${receipt?.durationMs ?? 0}ms`
                : !staged.ok
                  ? staged.message
                  : envChanged
                    ? "环境已改，保存时会按当前 conda／容器重新试跑"
                    : receipt?.passed && !inputsAligned
                      ? "试跑输入已改，保存时会重新试跑"
                      : receipt
                        ? "试跑没有通过，看下面的日志"
                        : "保存时先用 Nextflow 模块测试试跑，通过后写入模块库"}
          </p>
          {tryRun.error && <p role="alert" className="text-destructive">{tryRun.error.message}</p>}
          {publish.error && <p role="alert" className="text-destructive">{publish.error.message}</p>}
          {receipt && (
            <>
              <h3 className="font-semibold">日志 {logMark}</h3>
              <pre className="min-h-32 flex-1 overflow-auto rounded-lg bg-secondary/60 p-3 font-mono text-xs">{receipt.log}</pre>
              {receipt.bindings && <TryRunBindingTable bindings={receipt.bindings} />}
              <table className="w-full text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr><th className="py-1">输出端口</th><th>文件</th><th>大小</th><th>契约</th></tr>
                </thead>
                <tbody>
                  {receipt.outputs.map((output) => (
                    <tr key={output.name} className="border-t border-border">
                      <td className="py-1 font-mono">{output.name}</td>
                      <td className="font-mono">{output.file}</td>
                      <td>{output.bytes ? `${output.bytes} B` : "—"}</td>
                      <td className={output.ok ? "text-success" : "text-destructive"}>{output.ok ? "符合" : "不符合"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {passed && receipt?.bindings?.length ? (
            <ul className="grid gap-1 font-mono text-xs">
              {receipt.bindings.map((binding) => (
                <li key={binding.port}>{binding.port} · {SOURCE_LABEL[binding.source]} · {binding.label}</li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>

      <footer className="glass flex items-center justify-between rounded-xl px-4 py-3">
        <Button type="button" variant="outline" onClick={() => router.push(`/workbench/${notebookId}`)}>
          返回笔记本
        </Button>
        <Button type="button" disabled={busy || !name.trim() || !staged.ok || !canConvert} onClick={save}>
          {busy ? <Loader2 className="animate-spin" /> : null}
          {tryRun.isPending ? "试跑中…" : publish.isPending ? "保存中…" : passed ? saveLabel : `试跑并${saveLabel}`}
        </Button>
      </footer>
    </div>
  );
}

export function PublishWizardRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params);
  return <PublishWizard notebookId={id} />;
}
