"use client";

import { KeyRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import type { SecretKey } from "../types";

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
export function SecretField({ name, saved, value, hint, onChange }: { name: SecretKey; saved: boolean; value: string | null | undefined; hint?: string; onChange: (value: string | null) => void }) {
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

