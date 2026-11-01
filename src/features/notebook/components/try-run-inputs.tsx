"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import {
  bytesLabel,
  defaultInputDraft,
  draftToBinding,
  isFileInput,
  isListInput,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_TOTAL_BYTES,
  previewBinding,
  safeUploadName,
  samplesForInput,
  SOURCE_LABEL,
  sourceChoices,
  type BindingFile,
  type InputDraft,
} from "@/features/notebook/input-bindings";
import type { MarkerInput, TryRunInputBinding } from "@/features/notebook/types";
import { cn } from "@/lib/utils";

function readFiles(files: File[]): Promise<BindingFile[]> {
  return Promise.all(files.map((file) => new Promise<BindingFile>((resolve, reject) => {
    let name: string;
    try {
      name = safeUploadName(file.name);
    } catch (error) {
      reject(error instanceof Error ? error : new Error("上传文件名无效"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve({ name, contentBase64: comma === -1 ? result : result.slice(comma + 1) });
    };
    reader.onerror = () => reject(reader.error ?? new Error("无法读取文件"));
    reader.readAsDataURL(file);
  })));
}

function PortBinding({
  input,
  draft,
  onChange,
}: {
  input: MarkerInput;
  draft: InputDraft;
  onChange: (draft: InputDraft) => void;
}) {
  const samples = samplesForInput(input);
  const choices = sourceChoices(input);
  const preview = previewBinding(input, draft);
  const [readError, setReadError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const file = isFileInput(input);
  const list = isListInput(input);
  const activeSample = samples.find((sample) => sample.id === draft.sampleId) ?? samples[0];

  const choose = (source: InputDraft["source"]) => {
    if (source === draft.source) return;
    setReadError(null);
    onChange({
      ...draft,
      source,
      sampleId: draft.sampleId || samples[0]?.id || "",
      path: draft.path || (source === "path" ? (input.defaultValue ?? activeSample?.value ?? "") : draft.path),
    });
  };

  const onFiles = async (listFiles: FileList | null) => {
    const selected = listFiles ? [...listFiles] : [];
    if (!selected.length) return;
    const tooBig = selected.find((item) => item.size > MAX_UPLOAD_BYTES);
    if (tooBig) {
      setReadError(`端口 ${input.name} 的上传超过 ${bytesLabel(MAX_UPLOAD_BYTES)}`);
      return;
    }
    const total = selected.reduce((sum, item) => sum + item.size, 0);
    if (total > MAX_UPLOAD_TOTAL_BYTES) {
      setReadError(`上传合计超过 ${bytesLabel(MAX_UPLOAD_TOTAL_BYTES)}`);
      return;
    }
    try {
      const files = await readFiles(selected);
      setReadError(null);
      onChange({ ...draft, source: "upload", files });
    } catch (error) {
      setReadError(error instanceof Error ? error.message : "无法读取文件");
    }
  };

  return (
    <div role="group" aria-label={input.name} className="grid gap-2 rounded-lg border border-border p-2">
      <FormField label={`${input.name} · ${input.type}${input.required ? " · 必填" : ""}`}>
        <div role="radiogroup" aria-label={`${input.name} 来源`} className="flex rounded-lg bg-secondary p-0.5 text-xs">
          {choices.map((choice) => {
            const selected = draft.source === choice.source;
            return (
              <button
                key={choice.source}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={choice.disabled}
                title={choice.reason}
                className={cn(
                  "flex-1 rounded-md px-2 py-1",
                  selected && "bg-glass-strong text-foreground shadow-sm",
                  !selected && "text-muted-foreground hover:text-foreground",
                  choice.disabled && "cursor-not-allowed opacity-40 hover:text-muted-foreground",
                )}
                onClick={() => choose(choice.source)}
              >
                {SOURCE_LABEL[choice.source]}
              </button>
            );
          })}
        </div>
      </FormField>

      {draft.source === "upload" && file && (
        <div className="grid gap-1.5">
          <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => fileRef.current?.click()}>
            选择文件
          </Button>
          <input
            ref={fileRef}
            id={`upload-${input.name}`}
            type="file"
            multiple={list}
            aria-label={`上传 ${input.name}`}
            tabIndex={-1}
            className="sr-only"
            onChange={(event) => {
              void onFiles(event.target.files);
              event.target.value = "";
            }}
          />
          {draft.files.length > 0 && (
            <ul className="grid gap-1 text-xs">
              {draft.files.map((item) => (
                <li key={item.name} className="flex items-center gap-2 font-mono">
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => onChange({ ...draft, files: draft.files.filter((fileItem) => fileItem.name !== item.name) })}
                  >
                    移除
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-muted-foreground">单个文件不超过 {bytesLabel(MAX_UPLOAD_BYTES)}，合计不超过 {bytesLabel(MAX_UPLOAD_TOTAL_BYTES)}。</p>
        </div>
      )}

      {draft.source === "path" && (
        <Input
          id={`arg-${input.name}`}
          aria-label={`${input.name} 路径`}
          value={draft.path}
          placeholder={file ? "/data/input.txt" : undefined}
          onChange={(event) => onChange({ ...draft, path: event.target.value })}
          className="h-8 font-mono text-xs"
        />
      )}

      {draft.source === "sample" && activeSample && (
        <p className="font-mono text-xs text-muted-foreground">{activeSample.label}</p>
      )}

      {draft.source === "path" && file && (
        <p className="text-[11px] text-muted-foreground">本机路径。文件存在时复制进试跑目录，命令行使用文件名。</p>
      )}

      <p role={preview.ok && !readError ? "status" : "alert"} className={cn("text-[11px]", preview.ok && !readError ? "text-muted-foreground" : "text-destructive")}>
        {readError ?? (preview.ok ? preview.line : preview.message)}
      </p>
    </div>
  );
}

export function TryRunInputs({
  inputs,
  drafts,
  onChange,
}: {
  inputs: MarkerInput[];
  drafts: Record<string, InputDraft>;
  onChange: (port: string, draft: InputDraft) => void;
}) {
  return (
    <div className="grid gap-3">
      {inputs.map((input) => (
        <PortBinding
          key={input.name}
          input={input}
          draft={drafts[input.name] ?? defaultInputDraft(input)}
          onChange={(draft) => onChange(input.name, draft)}
        />
      ))}
    </div>
  );
}

export function TryRunBindingTable({ bindings }: { bindings: TryRunInputBinding[] }) {
  if (!bindings.length) return null;
  return (
    <table className="mt-3 w-full text-left text-xs">
      <thead className="text-muted-foreground">
        <tr>
          <th className="py-1">输入端口</th>
          <th>来源</th>
          <th>内容</th>
        </tr>
      </thead>
      <tbody>
        {bindings.map((binding) => (
          <tr key={binding.port} className="border-t border-border">
            <td className="py-1 font-mono">{binding.port}</td>
            <td>{SOURCE_LABEL[binding.source]}</td>
            <td className="font-mono">{binding.label}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function bindingsFromDrafts(inputs: MarkerInput[], drafts: Record<string, InputDraft>) {
  return inputs.map((input) => draftToBinding(input, drafts[input.name] ?? defaultInputDraft(input)));
}
