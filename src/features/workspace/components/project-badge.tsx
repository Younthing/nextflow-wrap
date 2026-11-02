import { projectBadge, type BadgeTone } from "@/features/workspace/projects";
import { cn } from "@/lib/utils";

const TONES: Record<BadgeTone, string> = {
  primary: "bg-primary/15 text-primary",
  path: "bg-port-path/15 text-port-path",
  file: "bg-port-file/15 text-port-file",
  meta: "bg-port-meta/20 text-port-meta",
  value: "bg-port-value/15 text-port-value",
  destructive: "bg-destructive/12 text-destructive",
};

/** First character on a tinted square, the same tone every time for one project name. */
export function ProjectBadge({ name, className }: { name: string; className?: string }) {
  const { initial, tone } = projectBadge(name);
  return (
    <span aria-hidden className={cn("grid size-7 shrink-0 place-items-center rounded-lg text-xs font-bold", TONES[tone], className)}>
      {initial}
    </span>
  );
}
