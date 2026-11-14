"use client";

import { useSuggestions } from "@copilotkit/react-core/v2";
import { Sparkles } from "lucide-react";

const general = [
  { title: "助手能做什么", message: "简要介绍你能怎样协助我编写分析笔记本、搭建流程和诊断运行。" },
  { title: "规划分析", message: "帮我规划一次分析。先问我需要分析什么数据，以及想得到什么结果。" },
];

export function ChatGuidance({ disabled, onPick }: { disabled: boolean; onPick: (text: string) => void }) {
  const { suggestions } = useSuggestions();
  const choices = suggestions.length ? suggestions : general;
  return (
    <div className="pointer-events-auto mb-2 flex gap-1.5 overflow-x-auto pb-1 text-xs" role="group" aria-label="快捷建议">
      <Sparkles aria-hidden className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
      {choices.map((item) => (
        <button key={item.message} type="button" disabled={disabled}
          className="shrink-0 rounded-full border border-border px-2.5 py-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
          title={item.message} onClick={() => onPick(item.message)}>
          {item.title}
        </button>
      ))}
    </div>
  );
}
