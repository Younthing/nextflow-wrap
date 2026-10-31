"use client";

import { useId } from "react";
import { FormField as Field } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { useEditorStore } from "@/features/editor/editor-provider";
import { defaultProjectSettings } from "../generate";

export function ProjectSettingsForm() {
  const formId = useId();
  const name = useEditorStore((s) => s.name);
  const stored = useEditorStore((s) => s.project);
  const setProject = useEditorStore((s) => s.setProject);
  const project = stored ?? defaultProjectSettings({ name });
  const set = (patch: Partial<typeof project>) =>
    setProject({ ...project, ...patch });

  return (
    <section className="grid gap-3">
      <h3 className="text-xs font-semibold text-muted-foreground">
        项目信息（manifest）
      </h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="项目名" htmlFor={`${formId}-proj-name`}>
          <Input
            id={`${formId}-proj-name`}
            value={project.name}
            onChange={(e) =>
              set({ name: e.target.value.replace(/[^\w/.-]/g, "") })
            }
            className="h-9 font-mono text-xs"
          />
        </Field>
        <Field label="版本" htmlFor={`${formId}-proj-version`}>
          <Input
            id={`${formId}-proj-version`}
            value={project.version}
            onChange={(e) => set({ version: e.target.value })}
            className="h-9 font-mono text-xs"
          />
        </Field>
        <Field label="作者" htmlFor={`${formId}-proj-author`}>
          <Input
            id={`${formId}-proj-author`}
            value={project.author}
            onChange={(e) => set({ author: e.target.value })}
            className="h-9 text-xs"
          />
        </Field>
      </div>
    </section>
  );
}
