"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { missingEnvLabels } from "@/features/notebook/env";
import type { ScriptModuleView } from "@/features/notebook/library";
import { useUpdateScriptModuleEnv } from "@/features/notebook/queries";
import { scriptEnvDirectives } from "@/features/project/script-process";

export function ModuleEnvFields({
  condaYaml,
  containerImage,
  onCondaYaml,
  onContainerImage,
  idPrefix = "module-env",
}: {
  condaYaml: string;
  containerImage: string;
  onCondaYaml: (value: string) => void;
  onContainerImage: (value: string) => void;
  idPrefix?: string;
}) {
  return (
    <div className="grid gap-3">
      <FormField label="Conda yaml 路径" htmlFor={`${idPrefix}-conda`} hint="环境文件路径，写进 process 的 conda">
        <Input
          id={`${idPrefix}-conda`}
          value={condaYaml}
          placeholder="/envs/py311-pandas.yml"
          onChange={(event) => onCondaYaml(event.target.value)}
          className="h-8 font-mono text-xs"
        />
      </FormField>
      <FormField label="容器地址" htmlFor={`${idPrefix}-container`} hint="镜像引用，写进 process 的 container">
        <Input
          id={`${idPrefix}-container`}
          value={containerImage}
          placeholder="ghcr.io/org/py311-pandas:1.2"
          onChange={(event) => onContainerImage(event.target.value)}
          className="h-8 font-mono text-xs"
        />
      </FormField>
    </div>
  );
}

export function ModuleEnvPreview({
  condaYaml,
  containerImage,
}: {
  condaYaml: string;
  containerImage: string;
}) {
  const directives = scriptEnvDirectives({ condaYaml, containerImage });
  const condaLine = directives.find((line) => line.startsWith("conda ")) ?? "conda （省略）";
  const imageLine = directives.find((line) => line.startsWith("container ")) ?? "container （省略）";
  const missing = missingEnvLabels({ condaYaml, containerImage });
  return (
    <div className="grid content-start gap-2 text-xs">
      <p className="rounded-md border border-dashed border-border bg-secondary/50 px-3 py-2 text-muted-foreground">
        手填两项 → 写入 ModuleDef → 生成 process 的 conda / container
      </p>
      <table className="w-full text-left">
        <tbody>
          <tr className="border-b border-border">
            <th className="w-24 py-1.5 font-normal text-muted-foreground">ModuleDef</th>
            <td className="py-1.5 font-mono">condaYaml · containerImage</td>
          </tr>
          <tr className="border-b border-border">
            <th className="py-1.5 align-top font-normal text-muted-foreground">process</th>
            <td className="py-1.5 font-mono">
              <div>{condaLine}</div>
              <div>{imageLine}</div>
            </td>
          </tr>
          <tr>
            <th className="py-1.5 align-top font-normal text-muted-foreground">试跑</th>
            <td className="py-1.5 text-muted-foreground" role={missing.length ? "status" : undefined}>
              {missing.length
                ? `未填写${missing.join("和")}。可以保存，生成的 process 会省略对应指令。本地试跑仍用笔记本内核。`
                : "本地试跑仍用笔记本内核。这两项写入 process，供流程按 conda 或容器配置运行。"}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function ModuleEnvEditor({ module }: { module: ScriptModuleView }) {
  const update = useUpdateScriptModuleEnv();
  const [condaYaml, setCondaYaml] = React.useState(module.condaYaml ?? "");
  const [containerImage, setContainerImage] = React.useState(module.containerImage ?? "");
  const [saved, setSaved] = React.useState(false);
  const idPrefix = `env-${module.id.replace(/[^\w-]/g, "-")}`;

  return (
    <section className="rounded-lg border border-border p-4" aria-label={`${module.name} 环境`}>
      <h2 className="text-sm font-semibold">
        模块详情 · 环境手填
        <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">{module.name} · {module.version}</span>
      </h2>
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <div className="grid gap-3">
          <FormField label="模块名" htmlFor={`${idPrefix}-name`}>
            <Input id={`${idPrefix}-name`} value={module.name} readOnly className="h-8 font-mono text-xs" />
          </FormField>
          <ModuleEnvFields
            idPrefix={idPrefix}
            condaYaml={condaYaml}
            containerImage={containerImage}
            onCondaYaml={(value) => {
              setSaved(false);
              setCondaYaml(value);
            }}
            onContainerImage={(value) => {
              setSaved(false);
              setContainerImage(value);
            }}
          />
        </div>
        <ModuleEnvPreview condaYaml={condaYaml} containerImage={containerImage} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={update.isPending}
          onClick={() => {
            update.mutate(
              { id: module.id, condaYaml, containerImage },
              {
                onSuccess: (savedMod) => {
                  setCondaYaml(savedMod.condaYaml ?? "");
                  setContainerImage(savedMod.containerImage ?? "");
                  setSaved(true);
                },
              },
            );
          }}
        >
          {update.isPending ? <Loader2 className="animate-spin" /> : null}
          保存环境
        </Button>
        {saved ? <span className="text-xs text-success">已写入这个版本</span> : null}
        {update.error ? <p role="alert" className="text-xs text-destructive">{update.error.message}</p> : null}
      </div>
    </section>
  );
}
