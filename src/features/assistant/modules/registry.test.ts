import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { HOST_PROMPT, composeAssistantPrompt } from "./compose";
import { canvasEditModule } from "./canvas-edit";
import { ASSISTANT_MODULES_PROP, moduleTool } from "./contract";
import { notebookModule } from "./notebook";
import { RUN_LOG_TAIL, runDiagnosticsModule } from "./run-diagnostics";
import { ASSISTANT_MODULES } from "./registry";
import { readAssistantModuleIds, requestAssistantPrompt } from "./request";

const MARKERS: Record<string, string> = {
  "canvas-edit": "search_modules",
  "run-diagnostics": "get_task_log",
  notebook: "get_notebook_summary",
  publish: "发布为模块",
  "env-config": "conda yaml",
};

function source(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

function registeredTools(text: string): string[] {
  return [...text.matchAll(/moduleTool\(\s*[A-Za-z0-9_]+\s*,\s*"([^"]+)"\s*\)/g)].map((match) => match[1] ?? "");
}

describe("assistant module registry", () => {
  it("registers each scenario once, with isolated prompts and tool names", () => {
    expect(ASSISTANT_MODULES.map((module) => module.id)).toEqual([
      "canvas-edit",
      "run-diagnostics",
      "notebook",
      "publish",
      "env-config",
    ]);
    expect(HOST_PROMPT).toContain("Nextflow Studio");
    expect(HOST_PROMPT).toMatch(/确认/);

    for (const entry of ASSISTANT_MODULES) {
      const marker = MARKERS[entry.id];
      expect(marker, entry.id).toBeTruthy();
      expect(entry.prompt).toContain(marker);
      expect(HOST_PROMPT).not.toContain(marker);
      const own = [entry.prompt, ...entry.tools.map((tool) => `${tool.name}\n${tool.description}`)].join("\n");
      for (const other of ASSISTANT_MODULES) {
        if (other.id === entry.id) continue;
        expect(entry.prompt).not.toContain(MARKERS[other.id]);
        for (const tool of other.tools) expect(own).not.toContain(tool.name);
      }
      for (const tool of entry.tools) expect(HOST_PROMPT).not.toContain(tool.name);
    }

    expect(canvasEditModule.tools.map((tool) => tool.name)).toEqual([
      "search_modules",
      "add_module",
      "connect_nodes",
      "disconnect_nodes",
      "remove_node",
      "configure_node",
      "set_pipeline_param",
      "start_run",
    ]);
    expect(runDiagnosticsModule.tools.map((tool) => tool.name)).toEqual([
      "get_task_log",
      "get_run_log",
      "cancel_run",
      "resume_run",
    ]);
    expect(notebookModule.tools.map((tool) => tool.name)).toEqual([
      "get_notebook_summary",
      "edit_notebook_cell",
      "run_notebook_cell",
      "read_cell_output",
    ]);
    expect(moduleTool(runDiagnosticsModule, "get_run_log").description).toContain(String(RUN_LOG_TAIL));
    expect(moduleTool(notebookModule, "run_notebook_cell").description).toMatch(/确认/);
    expect(notebookModule.prompt).not.toMatch(/没有改笔记本的工具|不要假装已经修改/);
    expect(ASSISTANT_MODULES.filter((module) => module.tools.length === 0).map((module) => module.id)).toEqual([
      "publish",
      "env-config",
    ]);
    expect(ASSISTANT_MODULES.some((module) => "defaultActive" in module)).toBe(false);
  });

  it("composes the host plus only the mounted modules", () => {
    const both = composeAssistantPrompt(["run-diagnostics", "canvas-edit"]);
    expect(both).toContain("start_run");
    expect(both).toContain("cancel_run");
    expect(both).toContain("resume_run");
    expect(both).not.toContain("get_notebook_summary");
    expect(both).not.toContain("你不能启动或停止运行");

    const canvasOnly = composeAssistantPrompt(["canvas-edit"]);
    expect(canvasOnly).toContain("search_modules");
    expect(canvasOnly).toContain("start_run");
    expect(canvasOnly).not.toContain("get_task_log");
    expect(canvasOnly).not.toContain("cancel_run");

    const runOnly = composeAssistantPrompt(["run-diagnostics"]);
    expect(runOnly).toContain("get_task_log");
    expect(runOnly).toContain("cancel_run");
    expect(runOnly).not.toContain("search_modules");
    expect(runOnly).not.toContain("start_run");

    expect(composeAssistantPrompt([])).toBe(HOST_PROMPT.trim());
    expect(composeAssistantPrompt(["missing"])).toBe(HOST_PROMPT.trim());
    expect(composeAssistantPrompt(["notebook", "notebook"])).toBe(composeAssistantPrompt(["notebook"]));

    const ordered = composeAssistantPrompt(["env-config", "canvas-edit"]);
    expect(ordered.indexOf("search_modules")).toBeLessThan(ordered.indexOf("conda yaml"));
  });

  it("reads the mounted module list, treats a missing one as empty, and leaves the body readable", async () => {
    expect(readAssistantModuleIds(null)).toEqual([]);
    expect(readAssistantModuleIds({})).toEqual([]);
    expect(readAssistantModuleIds({ forwardedProps: {} })).toEqual([]);
    expect(readAssistantModuleIds({ forwardedProps: { [ASSISTANT_MODULES_PROP]: "notebook" } })).toEqual([]);
    expect(readAssistantModuleIds({ forwardedProps: { [ASSISTANT_MODULES_PROP]: [" notebook ", "", "notebook", 1] } })).toEqual(["notebook"]);

    const body = { forwardedProps: { assistantModules: ["notebook"] }, messages: [{ role: "user" }] };
    const request = new Request("http://127.0.0.1:3000/api/copilotkit/agent/default/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const prepared = await requestAssistantPrompt(request);
    expect(prepared.prompt).toContain("脚本笔记本");
    expect(prepared.prompt).toContain("run_notebook_cell");
    expect(prepared.prompt).not.toContain("search_modules");
    await expect(prepared.request.json()).resolves.toEqual(body);

    const info = new Request("http://127.0.0.1:3000/api/copilotkit/info");
    const untouched = await requestAssistantPrompt(info);
    expect(untouched.request).toBe(info);
    expect(untouched.prompt).toBe(HOST_PROMPT.trim());

    const bare = await requestAssistantPrompt(new Request("http://127.0.0.1:3000/api/copilotkit/agent/default/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    }));
    expect(bare.prompt).toBe(HOST_PROMPT.trim());
  });

  it("keeps the host thin and the surfaces bound to their module specs", () => {
    const route = source("../copilot-route.ts");
    expect(route).toContain("requestAssistantPrompt");
    expect(route).not.toMatch(/surfaces|assistant-actions|search_modules|get_task_log|get_notebook_summary|搭建流程/);

    const provider = source("../assistant-provider.tsx");
    expect(provider).toContain("ASSISTANT_MODULES_PROP");
    expect(provider).toContain("AssistantModuleHost");
    expect(provider).not.toMatch(/canvas-edit|assistant-actions|run-diagnostics|notebook/);

    const canvas = source("../surfaces/canvas.tsx") + source("../surfaces/canvas-start-run.tsx");
    expect(canvas).toContain("useAssistantModule(canvasEditModule.id)");
    expect([...new Set(registeredTools(canvas))].sort()).toEqual([...canvasEditModule.tools.map((tool) => tool.name)].sort());
    expect(canvas).not.toMatch(/name:\s*"/);

    const run = source("../surfaces/run.tsx") + source("../surfaces/run-control.tsx");
    expect(run).toContain("useAssistantModule(runDiagnosticsModule.id)");
    expect([...new Set(registeredTools(run))].sort()).toEqual([...runDiagnosticsModule.tools.map((tool) => tool.name)].sort());
    expect(run).not.toMatch(/name:\s*"/);

    const notebook = source("../surfaces/notebook.tsx");
    expect(notebook).toContain("useAssistantModule(notebookModule.id)");
    expect([...new Set(registeredTools(notebook))].sort()).toEqual([...notebookModule.tools.map((tool) => tool.name)].sort());
    expect(notebook).not.toMatch(/name:\s*"/);

    // Surfaces register tools; the domain owns what they do.
    for (const surface of [canvas, run, notebook]) expect(surface).not.toMatch(/getState\(\)\.(add|remove|connect|set)/);
    expect(source("../../notebook/components/notebook-editor.tsx")).toContain("<NotebookAssistant ");
    expect(source("../../notebook/components/publish-wizard.tsx")).toContain("<PublishAssistant />");
    expect(source("../../notebook/components/publish-wizard.tsx")).toContain("<EnvConfigAssistant />");
    expect(source("../../workflow/components/module-catalog.tsx")).toContain("<EnvConfigAssistant />");
  });
});
