"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { useLayoutStore } from "@/components/layout/layout-store";
import { PathBrowserDialog } from "@/features/files/components/path-input";
import { useFsListing } from "@/features/files/queries";
import { NewProjectDialog } from "@/features/workspace/components/new-project-dialog";
import { useCloseProject, useCreateProject, useOpenProject, useProjects, useReopenProject } from "@/features/workspace/queries";
import type { CreateProjectRequest } from "@/features/workspace/types";
import { desktop, type DesktopMenuAction } from "@/lib/desktop";
import { toast } from "@/lib/toast";
import { useIsDesktop } from "@/lib/use-desktop";
import { projectMenuState } from "./project-menu";

/**
 * The page side of the desktop app's File and View menus: keeps the menu's project items in step with the
 * project list and carries out its commands with the same mutations the welcome page uses. Renders only the
 * new-project dialog, and nothing at all in a browser.
 */
export function DesktopMenuBridge() {
  const isDesktop = useIsDesktop();
  return isDesktop ? <MenuBridge /> : null;
}

function MenuBridge() {
  const router = useRouter();
  const projects = useProjects();
  const create = useCreateProject();
  const openPath = useOpenProject();
  const reopen = useReopenProject();
  const close = useCloseProject();
  const togglePanel = useLayoutStore((state) => state.togglePanel);
  const [creating, setCreating] = React.useState(false);
  const [browsing, setBrowsing] = React.useState(false);
  const home = useFsListing(undefined, creating || browsing).data?.home;

  React.useEffect(() => {
    if (projects.data) desktop()?.setProjectMenu?.(projectMenuState(projects.data));
  }, [projects.data]);

  const enter = React.useCallback(() => router.push("/workbench"), [router]);
  const fail = React.useCallback((error: Error) => toast.error(error.message), []);

  const handle = React.useEffectEvent(async (action: DesktopMenuAction) => {
    switch (action.type) {
      case "new-project":
        create.reset();
        setCreating(true);
        return;
      case "open-folder": {
        // The folder is chosen on the server, like everywhere else.
        setBrowsing(true);
        return;
      }
      case "open-project":
        reopen.mutate(action.id, { onSuccess: enter, onError: fail });
        return;
      case "close-project":
        close.mutate(undefined, { onSuccess: () => router.push("/"), onError: fail });
        return;
      case "toggle-panel":
        togglePanel(action.panel);
        return;
    }
  });

  React.useEffect(() => desktop()?.onMenuAction?.((action) => void handle(action)), []);

  return (
    <>
      <NewProjectDialog
        open={creating}
        onOpenChange={setCreating}
        defaultParent={home ?? ""}
        pending={create.isPending}
        error={create.error?.message}
        onCreate={(request: CreateProjectRequest) => create.mutate(request, { onSuccess: () => { setCreating(false); enter(); } })}
      />
      {browsing ? (
        <PathBrowserDialog
          open={browsing}
          onOpenChange={setBrowsing}
          options={{ kind: "directory", title: "打开目录作为项目", defaultPath: home }}
          onPick={(path) => openPath.mutate(path, { onSuccess: enter, onError: fail })}
        />
      ) : null}
    </>
  );
}
