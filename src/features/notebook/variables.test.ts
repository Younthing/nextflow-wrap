import { describe, expect, it, vi } from "vitest";

import { createNotebookActions, notebookVariablesContext, type NotebookDocumentApi } from "./assistant-actions";
import { parseProbe, variableSource, variablesProbe } from "./server/kernel-variables";
import type { KernelSession } from "./server/kernels";
import { createNotebookSession } from "./session";
import { fixtureNotebooks } from "./test-fixtures";
import type { NotebookVariables } from "./types";

const notebook = fixtureNotebooks(0)[0];
const listed: NotebookVariables = {
  available: true,
  kernel: "python3",
  total: 2,
  variables: [
    { name: "df", type: "DataFrame", size: "2×2", preview: "   a  b" },
    { name: "n", type: "int", preview: "3" },
  ],
};

function actionsWith(variables: NotebookVariables, read: NotebookDocumentApi["readVariable"] = vi.fn()) {
  const commands: NotebookDocumentApi = {
    read: () => ({ doc: notebook, outputs: {}, busy: false }),
    setCells: vi.fn(),
    runCell: vi.fn(),
    refreshVariables: vi.fn(async () => variables),
    readVariable: read,
  };
  return { commands, actions: createNotebookActions(commands) };
}

describe("notebook variables for the assistant", () => {
  it("puts names, types and sizes in the chat context, or the reason there are none", () => {
    expect(notebookVariablesContext(null)).toBeNull();
    expect(notebookVariablesContext(listed)).toEqual({ available: true, total: 2, variables: ["df: DataFrame (2×2)", "n: int"] });
    expect(notebookVariablesContext({ available: false, reason: "内核还没启动。", variables: [] })).toEqual({ available: false, reason: "内核还没启动。" });
    const many: NotebookVariables = { ...listed, total: 80, variables: Array.from({ length: 80 }, (_, i) => ({ name: `v${i}`, type: "int", preview: "0" })) };
    expect(notebookVariablesContext(many)).toMatchObject({ total: 80, note: expect.stringMatching(/list_notebook_variables/) });
  });

  it("lists fresh variables and reads one by name", async () => {
    const read = vi.fn(async (name: string) =>
      name === "df"
        ? { available: true as const, found: true as const, variable: { ...listed.variables[0], repr: "   a  b\n0  1  x", columns: [{ name: "a", dtype: "int64" }] } }
        : { available: true as const, found: false as const, name },
    );
    const { actions, commands } = actionsWith(listed, read);
    expect(await actions.listVariables()).toMatchObject({ available: true, total: 2 });
    expect(commands.refreshVariables).toHaveBeenCalledOnce();
    expect(await actions.getVariable(" df ")).toMatchObject({ available: true, name: "df", columns: [{ name: "a" }] });
    expect(read).toHaveBeenCalledWith("df");
    await expect(actions.getVariable("nope")).rejects.toThrow(/没有变量 nope/);
    await expect(actions.getVariable("")).rejects.toThrow(/需要变量名/);
  });

  it("passes on why variables are unavailable instead of inventing any", async () => {
    const { actions } = actionsWith({ available: false, reason: "R 笔记本暂不支持列出变量。", variables: [] }, async () => ({ available: false, reason: "R 笔记本暂不支持列出变量。" }));
    expect(await actions.listVariables()).toEqual({ available: false, reason: "R 笔记本暂不支持列出变量。", variables: [] });
    expect(await actions.getVariable("x")).toEqual({ available: false, reason: "R 笔记本暂不支持列出变量。" });
  });

  it("keeps only the newest read in the session", async () => {
    let release: (value: NotebookVariables) => void = () => {};
    const variables = vi
      .fn<(id: string) => Promise<NotebookVariables>>()
      .mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }))
      .mockResolvedValueOnce(listed);
    const session = createNotebookSession({ notebookId: notebook.id, saved: notebook, ports: { save: vi.fn(), run: vi.fn(), variables } });
    const slow = session.refreshVariables();
    await session.refreshVariables();
    release({ available: false, reason: "旧的", variables: [] });
    await slow;
    expect(session.store.getState().variables).toBe(listed);
  });

  it("reports a session without a variables port as unavailable", async () => {
    const session = createNotebookSession({ notebookId: notebook.id, saved: notebook, ports: { save: vi.fn(), run: vi.fn() } });
    expect(await session.refreshVariables()).toMatchObject({ available: false });
  });
});

describe("kernel variable probe", () => {
  const session = (patch: Partial<KernelSession>) => ({ state: "idle", requested: notebook.kernel, ...patch }) as KernelSession;

  it("says why there is nothing to read without starting a kernel", () => {
    expect(variableSource({ ...notebook, language: "r" }, session({}))).toEqual({ reason: expect.stringMatching(/R 笔记本/) });
    expect(variableSource({ ...notebook, language: "python" }, undefined)).toEqual({ reason: expect.stringMatching(/还没启动/) });
    expect(variableSource({ ...notebook, language: "python" }, session({ state: "busy" }))).toEqual({ reason: expect.stringMatching(/正在运行/) });
    expect(variableSource({ ...notebook, language: "python" }, session({ requested: "other" }))).toEqual({ reason: expect.stringMatching(/换了内核/) });
    const idle = session({});
    expect(variableSource({ ...notebook, language: "python" }, idle)).toEqual({ session: idle });
  });

  it("passes the name as a Python string and cleans up its helper", () => {
    expect(variablesProbe()).toContain("__nf_variables(None, ");
    expect(variablesProbe("df")).toContain('__nf_variables("df", ');
    expect(variablesProbe()).toMatch(/finally:\n {4}del __nf_variables/);
  });

  it("reads the marker line and surfaces kernel errors", () => {
    const reply = (outputs: unknown[]) => ({ outputs, executionCount: null, status: "ok" as const });
    expect(parseProbe(reply([{ outputType: "stream", name: "stdout", text: 'noise\n__NF_VARIABLES__{"total": 0, "variables": []}\n' }]))).toEqual({ total: 0, variables: [] });
    expect(() => parseProbe(reply([{ outputType: "error", traceback: "Traceback\nNameError: x" }]))).toThrow(/NameError: x/);
    expect(() => parseProbe(reply([]))).toThrow(/没有返回结果/);
  });
});
