import type { Issue } from "@/features/workflow/validate";

export interface SaveConfirmation {
  tone: "success" | "warning";
  message: string;
}

/**
 * Manual save still writes the workflow. When validation errors are on the
 * document, the toast has to say they remain — a plain「已保存」reads as a
 * clean success. No errors, including a document that only has warnings,
 * keeps that confirmation.
 */
export function saveConfirmation(issues: readonly Pick<Issue, "level">[]): SaveConfirmation {
  const errors = issues.filter((issue) => issue.level === "error").length;
  if (errors === 0) return { tone: "success", message: "已保存" };
  return { tone: "warning", message: `已保存，但仍有 ${errors} 个错误` };
}
