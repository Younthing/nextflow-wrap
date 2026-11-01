"use client";

import * as React from "react";

import { PanelLoading, PanelNotice } from "@/components/ui/panel-notice";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToolChecklist } from "@/features/setup/components/tool-checklist";
import { useInstallTool, useSetupStatus } from "@/features/setup/queries";
import { toast } from "@/lib/toast";
import { useSaveSettings, useSettings } from "../queries";
import { SettingsForm } from "./settings-form";

/** Extra tabs other features add (disk usage, diagnostics). */
export interface SettingsSection { id: string; label: string; content: React.ReactNode }

function EnvironmentTab() {
  const status = useSetupStatus();
  const install = useInstallTool();
  if (status.isPending) return <PanelLoading message="正在检查运行环境…" className="h-40" />;
  if (status.isError) return <PanelNotice tone="danger" message={status.error.message} className="h-40" />;
  return (
    <div className="glass rounded-xl px-5">
      <ToolChecklist
        tools={status.data.tools}
        installing={install.isPending ? install.variables : undefined}
        onInstall={(tool) => install.mutate(tool.id, { onError: (error) => toast.error(error.message) })}
      />
    </div>
  );
}

function PreferencesTab() {
  const view = useSettings();
  const save = useSaveSettings();
  if (view.isPending) return <PanelLoading className="h-40" />;
  if (view.isError) return <PanelNotice tone="danger" message={view.error.message} className="h-40" />;
  return (
    <SettingsForm
      // A saved view resets the draft and clears typed keys.
      key={JSON.stringify(view.data)}
      view={view.data}
      saving={save.isPending}
      onSave={(update) => save.mutate(update, { onSuccess: () => toast.success("设置已保存"), onError: (error) => toast.error(error.message) })}
    />
  );
}

export function SettingsPage({ sections = [] }: { sections?: SettingsSection[] }) {
  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col gap-3 overflow-y-auto pb-6">
      <h1 className="font-serif text-xl font-semibold">设置</h1>
      <Tabs defaultValue="preferences" className="gap-3">
        <TabsList>
          <TabsTrigger value="preferences">偏好</TabsTrigger>
          <TabsTrigger value="environment">运行环境</TabsTrigger>
          {sections.map((section) => <TabsTrigger key={section.id} value={section.id}>{section.label}</TabsTrigger>)}
        </TabsList>
        <TabsContent value="preferences"><PreferencesTab /></TabsContent>
        <TabsContent value="environment"><EnvironmentTab /></TabsContent>
        {sections.map((section) => <TabsContent key={section.id} value={section.id}>{section.content}</TabsContent>)}
      </Tabs>
    </div>
  );
}
