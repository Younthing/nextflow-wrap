"use client";

import * as React from "react";
import { Atom } from "lucide-react";

import { AsyncPlaceholder } from "@/components/ui/async-placeholder";
import { moleculeFormat } from "../preview";

type Plugin = import("molstar/lib/mol-plugin/context").PluginContext;

/**
 * Loads a structure or docked pose into a Mol* canvas. Mol* is loaded on first use, so it adds nothing to pages
 * that never open a structure. Only the 3D canvas is used; rotate with the mouse, scroll to zoom.
 */
export function MoleculeViewer({ path, text }: { path: string; text: string }) {
  const container = React.useRef<HTMLDivElement>(null);
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const [state, setState] = React.useState<{ status: "loading" | "ready" | "error"; message?: string }>({ status: "loading" });
  const format = moleculeFormat(path);

  React.useEffect(() => {
    if (!format || !container.current || !canvas.current) return;
    let plugin: Plugin | undefined;
    let cancelled = false;
    void (async () => {
      const [{ PluginContext }, { DefaultPluginSpec }] = await Promise.all([
        import("molstar/lib/mol-plugin/context"),
        import("molstar/lib/mol-plugin/spec"),
      ]);
      if (cancelled) return;
      plugin = new PluginContext(DefaultPluginSpec());
      await plugin.init();
      if (!(await plugin.initViewerAsync(canvas.current!, container.current!))) throw new Error("浏览器不支持 WebGL");
      plugin.canvas3d?.setProps({ transparentBackground: true });
      const data = await plugin.builders.data.rawData({ data: text, label: path.split("/").at(-1) });
      const trajectory = await plugin.builders.structure.parseTrajectory(data, format);
      await plugin.builders.structure.hierarchy.applyPreset(trajectory, "default");
      if (!cancelled) setState({ status: "ready" });
    })().catch((error: unknown) => {
      if (!cancelled) setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
    });
    return () => { cancelled = true; plugin?.dispose(); };
  }, [format, path, text]);

  if (!format) return <AsyncPlaceholder status="empty" className="flex-1" icon={<Atom />} description="不认识的结构格式" />;
  return (
    <div className="relative min-h-[320px] flex-1 overflow-hidden rounded-md border border-border/60" ref={container}>
      <canvas ref={canvas} className="absolute inset-0 size-full" />
      {state.status === "loading" && <AsyncPlaceholder status="pending" className="absolute inset-0" />}
      {state.status === "error" && <AsyncPlaceholder status="error" className="absolute inset-0 h-auto" message={`无法显示结构：${state.message}`} />}
    </div>
  );
}
