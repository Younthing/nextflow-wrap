import { portKind } from "@/features/workflow/ports";
import type { PortDef } from "@/features/workflow/types";

export const PORT_COLORS = {
  file: "var(--port-file)",
  value: "var(--port-value)",
  meta: "var(--port-meta)",
  path: "var(--port-path)",
} as const;

export const portColor = (port: PortDef) => PORT_COLORS[portKind(port)];

/** Accent colour per library category, used for node headers. */
export const CATEGORY_COLORS: Record<string, string> = {
  输入: "oklch(0.7 0.15 75)",
  质控: "oklch(0.68 0.15 155)",
  比对: "oklch(0.62 0.17 262)",
  定量: "oklch(0.65 0.17 310)",
  "BAM 处理": "oklch(0.66 0.13 210)",
  变异检测: "oklch(0.64 0.19 25)",
  宏基因组: "oklch(0.66 0.14 130)",
  工具: "oklch(0.6 0.03 260)",
  通道: "oklch(0.72 0.12 200)",
};

export const categoryColor = (category: string) =>
  CATEGORY_COLORS[category] ?? "oklch(0.6 0.03 260)";
