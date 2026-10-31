import type { PublishDir } from "@/features/workflow/types";

/** One rule per line: `path|pattern|saveAs`. Pattern and saveAs may be omitted. */
export function parsePublishRules(text: string): PublishDir[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [path = "", pattern = "", saveAs = ""] = line.split("|").map((part) => part.trim());
      return {
        path,
        ...(pattern ? { pattern } : {}),
        ...(saveAs ? { saveAs } : {}),
      };
    })
    .filter((rule) => rule.path);
}

export function formatPublishRules(rules: PublishDir[] | undefined): string {
  return (rules ?? [])
    .map((rule) => [rule.path, rule.pattern ?? "", rule.saveAs ?? ""].join("|").replace(/\|+$/, ""))
    .join("\n");
}
