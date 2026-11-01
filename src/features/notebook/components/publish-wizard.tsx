"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Loader2 } from "lucide-react";

import { AsyncPlaceholder } from "@/components/ui/async-placeholder";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { convertNotebook, ConvertError, inputPorts, outputPorts } from "@/features/notebook/convert";
import { latestModuleForNotebook } from "@/features/notebook/library";
import { nextModuleVersion } from "@/features/notebook/publish";
import { useNotebook, usePublishNotebook, useScriptModules, useTryRunNotebook } from "@/features/notebook/queries";
import { kernelLabel } from "@/features/notebook/types";
import { cn } from "@/lib/utils";
import { ModuleEnvFields, ModuleEnvPreview } from "./module-env-form";

const STEPS = ["转化预览", "试跑 CLI", "保存为模块"];

function StepPill({ index, current }: { index: number; current: number }) {
  const done = current > index;
  const active = current === index;
  return (
    <div className={cn("flex items-center gap-2 rounded-full px-3 py-1 text-xs", active && "bg-primary/15 text-primary", !active && "text-muted-foreground")}>
      <span className={cn("grid size-5 place-items-center rounded-full border text-[11px]", done && "border-success bg-success/15 text-success", active && "border-primary")}>
        {done ? <Check className="size-3" /> : index}
      </span>
      {STEPS[index - 1]}
    </div>
  );
}

export function PublishWizard({ notebookId }: { notebookId: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const step = Math.min(3, Math.max(1, Number(params.get("step") ?? "1") || 1));
  const notebook = useNotebook(notebookId);
  const scripts = useScriptModules();
  const tryRun = useTryRunNotebook();
  const publish = usePublishNotebook();
  const [args, setArgs] = React.useState<Record<string, string>>({});
  const [seededFor, setSeededFor] = React.useState<string | null>(null);
  const [sampleId, setSampleId] = React.useState<string>("none");
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [changelog, setChangelog] = React.useState("");
  const [condaYaml, setCondaYaml] = React.useState("");
  const [containerImage, setContainerImage] = React.useState("");
  const [namedFor, setNamedFor] = React.useState<string | null>(null);
  const [envFor, setEnvFor] = React.useState<string | null>(null);

  const doc = notebook.data;
  const converted = React.useMemo(() => {
    if (!doc) return null;
    try {
      return { ok: true as const, value: convertNotebook(doc) };
    } catch (error) {
      return { ok: false as const, message: error instanceof ConvertError || error instanceof Error ? error.message : "无法转化" };
    }
  }, [doc]);

  if (doc && converted?.ok && seededFor !== doc.id) {
    const next: Record<string, string> = {};
    for (const input of converted.value.inputs) {
      if (input.defaultValue !== undefined) next[input.name] = input.defaultValue;
    }
    const wantsZip = converted.value.inputs.some((input) => /zip|fastq/i.test(input.name));
    if (wantsZip) {
      next.fastq_zip = next.fastq_zip || "S1_fastq.zip,S2_fastq.zip";
      setSampleId("fastqc-pair");
    }
    setArgs(next);
    setSeededFor(doc.id);
  }

  if (doc && namedFor !== doc.id) {
    setNamedFor(doc.id);
    setName(doc.name.replace(/\s+/g, "_"));
    setDescription(doc.description);
  }

  if (doc && scripts.isSuccess && envFor !== doc.id) {
    const previous = latestModuleForNotebook(scripts.data.modules, doc.id);
    setEnvFor(doc.id);
    if (!condaYaml && previous?.condaYaml) setCondaYaml(previous.condaYaml);
    if (!containerImage && previous?.containerImage) setContainerImage(previous.containerImage);
  }

  const go = (next: number) => router.replace(`/notebooks/${notebookId}/publish?step=${next}`);
  const version = doc ? nextModuleVersion(scripts.data?.modules ?? [], doc.id) : "v1";
  const receipt = tryRun.data;
  const passed = !!receipt?.passed && receipt.rev === doc?.rev;

  if (notebook.isPending) return <AsyncPlaceholder status="pending" className="h-full" />;
  if (notebook.error || !doc) return <AsyncPlaceholder status="error" className="h-auto" message={notebook.error?.message ?? "笔记本不存在"} />;

  return (
    <div className="flex size-full min-h-0 flex-col gap-3">
      <header className="glass flex flex-wrap items-center gap-3 rounded-xl px-4 py-3">
        <div>
          <div className="text-xs text-muted-foreground">
            <Link href={`/notebooks/${notebookId}`} className="hover:underline">笔记本 / {doc.name}</Link>
            <span> / 发布为模块</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {STEPS.map((label, index) => (
              <StepPill key={label} index={index + 1} current={step} />
            ))}
          </div>
        </div>
        <Button asChild variant="ghost" size="sm" className="ml-auto">
          <Link href={`/notebooks/${notebookId}`}>取消，回笔记本</Link>
        </Button>
      </header>

      {step === 1 && (
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <section className="glass min-h-0 overflow-auto rounded-xl p-4">
            <h2 className="text-sm font-semibold">生成的命令行</h2>
            <p className="mt-1 text-xs text-muted-foreground">只读 · 从笔记本自动转出。说明和自由探索单元格不会进入脚本。</p>
            {converted?.ok ? (
              <>
                <pre className="mt-3 overflow-auto rounded-lg bg-secondary/60 p-3 font-mono text-xs">{converted.value.commandPreview}</pre>
                <h3 className="mt-4 text-sm font-semibold">{converted.value.entry.split("/").pop()}</h3>
                <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-secondary/60 p-3 font-mono text-xs">{converted.value.script}</pre>
              </>
            ) : (
              <p className="mt-3 text-sm text-destructive">{converted?.message}</p>
            )}
          </section>
          <aside className="glass space-y-4 overflow-auto rounded-xl p-4">
            <div>
              <h2 className="text-sm font-semibold">端口</h2>
              <ul className="mt-2 grid gap-1 font-mono text-xs">
                {(converted?.ok ? inputPorts(converted.value.inputs) : []).map((port) => (
                  <li key={port.name}>入 · {port.name}{port.description === "文件列表" ? "[]" : ""}</li>
                ))}
                {(converted?.ok ? outputPorts(converted.value.outputs) : []).map((port) => (
                  <li key={port.name}>出 · {port.name}</li>
                ))}
              </ul>
            </div>
            <div className="text-xs text-muted-foreground">
              包含单元格 {(converted?.ok ? converted.value.included : []).map((cell) => `[${cell.index}]`).join(" ") || "无"}
              <br />
              排除 {(converted?.ok ? converted.value.excluded : []).map((cell) => `[${cell.index}] ${cell.role === "explore" ? "自由探索" : "说明"}`).join("、") || "无"}
            </div>
          </aside>
        </div>
      )}

      {step === 2 && converted?.ok && (
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <section className="glass space-y-3 overflow-auto rounded-xl p-4">
            <h2 className="text-sm font-semibold">试跑参数</h2>
            <p className="text-xs text-muted-foreground">内核 {kernelLabel(doc.kernel)}。试跑用本机解释器；conda／容器在下一步手填，不改这次试跑。</p>
            {converted.value.inputs.some((input) => /zip|fastq/i.test(input.name)) && (
              <FormField label="样例数据">
                <Select value={sampleId} onValueChange={setSampleId}>
                  <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">不使用样例</SelectItem>
                    <SelectItem value="fastqc-pair">内置样例：2 个 FastQC zip</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
            )}
            {converted.value.inputs.map((input) => (
              <FormField key={input.name} label={`${input.name} · ${input.type}${input.required ? " · 必填" : ""}`} htmlFor={`arg-${input.name}`}>
                <Input id={`arg-${input.name}`} value={args[input.name] ?? ""} onChange={(event) => setArgs((current) => ({ ...current, [input.name]: event.target.value }))} className="h-8 font-mono text-xs" />
              </FormField>
            ))}
            <Button
              type="button"
              variant="outline"
              disabled={tryRun.isPending}
              onClick={() => tryRun.mutate({ id: doc.id, args, sampleId: sampleId === "none" ? undefined : sampleId })}
            >
              {tryRun.isPending ? <Loader2 className="animate-spin" /> : null}
              {receipt ? "重新试跑" : "开始试跑"}
            </Button>
            {tryRun.error && <p role="alert" className="text-sm text-destructive">{tryRun.error.message}</p>}
          </section>
          <section className="glass flex min-h-0 flex-col overflow-hidden rounded-xl p-4">
            <h2 className="text-sm font-semibold">日志 {receipt ? (receipt.passed ? "· 通过" : "· 失败") : ""}</h2>
            <pre className="mt-3 min-h-32 flex-1 overflow-auto rounded-lg bg-secondary/60 p-3 font-mono text-xs">{receipt?.log || "试跑通过后才能保存。"}</pre>
            {receipt && (
              <table className="mt-3 w-full text-left text-xs">
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
            )}
          </section>
        </div>
      )}

      {step === 3 && (
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-2">
          <section className="glass space-y-3 rounded-xl p-4">
            <h2 className="text-sm font-semibold">模块信息</h2>
            <FormField label="模块名" htmlFor="module-name">
              <Input id="module-name" value={name} onChange={(event) => setName(event.target.value)} className="h-8 font-mono text-xs" />
            </FormField>
            <FormField label="说明" htmlFor="module-description">
              <Input id="module-description" value={description} onChange={(event) => setDescription(event.target.value)} className="h-8 text-xs" />
            </FormField>
            <FormField label="版本" htmlFor="module-version">
              <Input id="module-version" value={`${version}（${version === "v1" ? "首次发布" : "新版本"}）`} readOnly className="h-8 font-mono text-xs" />
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
            {publish.error && <p role="alert" className="text-sm text-destructive">{publish.error.message}</p>}
          </section>
          <section className="glass space-y-3 rounded-xl p-4 text-sm">
            <h2 className="font-semibold">将写入模块库</h2>
            <p>源笔记本 <span className="font-mono">{doc.name}</span> · 钉住 rev r{doc.rev}</p>
            <p>命令行 <span className="font-mono">{converted?.ok ? converted.value.entry : "—"}</span></p>
            <p>端口 {converted?.ok ? `${converted.value.inputs.length} 输入 · ${converted.value.outputs.length} 输出` : "—"}</p>
            <p>笔记本内核 <span className="font-mono">{kernelLabel(doc.kernel)}</span>，不写入 conda／容器。</p>
            <ModuleEnvPreview condaYaml={condaYaml} containerImage={containerImage} />
            <p className={passed ? "text-success" : "text-destructive"}>{passed ? `试跑通过 · ${receipt?.durationMs ?? 0}ms` : "还没有通过当前修订的试跑"}</p>
            <p className="text-xs text-muted-foreground">
              保存这一版的 jupytext 库副本（完整笔记本和命令行脚本）。源笔记本保持不动。之后可在模块库里把这一版重建成一本新的可编辑笔记本。
            </p>
          </section>
        </div>
      )}

      <footer className="glass flex items-center justify-between rounded-xl px-4 py-3">
        <Button type="button" variant="outline" onClick={() => (step === 1 ? router.push(`/notebooks/${notebookId}`) : go(step - 1))}>
          {step === 1 ? "返回笔记本" : step === 3 ? "返回试跑" : "上一步"}
        </Button>
        {step < 3 ? (
          <Button
            type="button"
            disabled={step === 1 ? !converted?.ok || converted.value.outputs.length === 0 : !passed}
            onClick={() => go(step + 1)}
          >
            {step === 1 ? "下一步：试跑" : "下一步：保存"}
          </Button>
        ) : (
          <Button
            type="button"
            disabled={!passed || publish.isPending || !name.trim()}
            onClick={() => {
              publish.mutate(
                { id: doc.id, name: name.trim(), description, changelog, condaYaml, containerImage },
                { onSuccess: () => router.push("/workflows/modules") },
              );
            }}
          >
            {publish.isPending ? <Loader2 className="animate-spin" /> : null}
            保存为模块 {version}
          </Button>
        )}
      </footer>
    </div>
  );
}

export function PublishWizardRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params);
  return <PublishWizard notebookId={id} />;
}
