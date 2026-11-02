"use client";

import { LifeBuoy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/lib/toast";
import { useDownloadDiagnostics } from "../queries";

const CONTENTS = [
  "应用版本、系统、数据目录和数据库版本",
  "运行环境检查结果（Java、Nextflow、插件、conda、Jupyter）",
  "设置（API key 只记录是否已设置）和相关环境变量",
  "应用日志和安装日志",
  "最近 20 次运行的状态和错误信息",
];

/** Settings tab: one button that saves a redacted `.tar.gz` to attach to a bug report. */
export function DiagnosticsPanel() {
  const download = useDownloadDiagnostics();
  return (
    <Card>
      <CardHeader>
        <CardTitle>导出诊断包</CardTitle>
        <CardDescription>密钥和密码已脱敏，不含结果文件和 work 目录</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {CONTENTS.map((line) => <li key={line}>{line}</li>)}
        </ul>
        <Button
          disabled={download.isPending}
          onClick={() => download.mutate(undefined, { onSuccess: (name) => toast.success(`已保存 ${name}`), onError: (error) => toast.error(error.message) })}
        >
          <LifeBuoy /> {download.isPending ? "正在打包…" : "导出诊断包"}
        </Button>
      </CardContent>
    </Card>
  );
}

/** Run page button: the bundle plus this run's logs, configs and tasks. */
export function RunDiagnosticsButton({ runId }: { runId: string }) {
  const download = useDownloadDiagnostics();
  return (
    <Button
      variant="ghost"
      size="sm"
      title="导出带这次运行日志的诊断包"
      disabled={download.isPending}
      onClick={() => download.mutate(runId, { onSuccess: (name) => toast.success(`已保存 ${name}`), onError: (error) => toast.error(error.message) })}
    >
      <LifeBuoy /> 诊断包
    </Button>
  );
}
