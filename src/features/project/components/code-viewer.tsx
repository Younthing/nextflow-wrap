"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProjectFile } from "../generate";

type Language = ProjectFile["language"];

const GROOVY_KEYWORDS =
  "include|from|workflow|process|take|main|emit|def|if|else|return|params|channel|true|false|null|new|in|withName|withLabel|profiles|manifest|nextflow|plugins|validation|includeConfig|publishDir|ext|when|output|input|script|tuple|path|val|env";

// One alternation per language; each group maps to a token class below.
const RULES: Partial<Record<Language, { re: RegExp; classes: string[] }>> = {
  groovy: {
    re: new RegExp(
      `(\\/\\/.*$|^\\s*\\/?\\*.*$)|('(?:[^'\\\\]|\\\\.)*'|"(?:[^"\\\\]|\\\\.)*")|\\b(${GROOVY_KEYWORDS})\\b|\\b(\\d+(?:\\.\\d+)?)\\b|\\b([A-Z][A-Z0-9_]{2,})\\b`,
      "g",
    ),
    classes: ["tok-comment", "tok-string", "tok-keyword", "tok-number", "tok-process"],
  },
  json: {
    re: /("(?:[^"\\]|\\.)*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)/g,
    classes: ["tok-string", "", "tok-keyword", "tok-number"],
  },
  yaml: {
    re: /(#.*$)|^(\s*-?\s*[\w.-]+)(?=:)|('(?:[^']*)'|"(?:[^"\\]|\\.)*")|\b(true|false|null)\b/g,
    classes: ["tok-comment", "tok-key", "tok-string", "tok-keyword"],
  },
  markdown: {
    re: /^(#{1,6} .*)$|(`[^`]+`)|(\[[^\]]+\]\([^)]+\))/g,
    classes: ["tok-keyword", "tok-string", "tok-process"],
  },
};

function highlightLine(line: string, language: Language): React.ReactNode[] {
  const rule = RULES[language];
  if (!rule) return [line];
  const out: React.ReactNode[] = [];
  let last = 0;
  rule.re.lastIndex = 0;
  for (const m of line.matchAll(rule.re)) {
    if (m.index === undefined || !m[0]) continue;
    if (m.index > last) out.push(line.slice(last, m.index));
    // JSON keys: a string followed by a colon.
    if (language === "json" && m[2]) {
      out.push(<span key={m.index} className="tok-key">{m[1]}</span>, m[2]);
    } else {
      const group = m.findIndex((g, i) => i > 0 && g !== undefined);
      out.push(
        <span key={m.index} className={rule.classes[group - 1]}>
          {m[0]}
        </span>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

export function CopyButton({ text, label = "复制", className }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      className={className}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check className="text-success" /> : <Copy />}
    </Button>
  );
}

export function CodeViewer({
  code,
  language,
  className,
  lineNumbers = true,
}: {
  code: string;
  language: Language;
  className?: string;
  lineNumbers?: boolean;
}) {
  const lines = React.useMemo(() => code.replace(/\n$/, "").split("\n"), [code]);
  const gutter = String(lines.length).length;
  return (
    <div className={cn("group relative overflow-auto rounded-lg bg-secondary/60 font-mono text-[12px] leading-5", className)}>
      <CopyButton text={code} className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100" />
      <pre className="min-w-fit p-3">
        <code>
          {lines.map((line, i) => (
            <div key={i} className="flex">
              {lineNumbers && (
                <span
                  className="mr-4 shrink-0 text-right text-muted-foreground/60 select-none"
                  style={{ width: `${gutter}ch` }}
                >
                  {i + 1}
                </span>
              )}
              <span className="whitespace-pre">{highlightLine(line, language)}</span>
            </div>
          ))}
        </code>
      </pre>
    </div>
  );
}
