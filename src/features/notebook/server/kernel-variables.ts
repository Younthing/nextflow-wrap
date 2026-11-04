import type { NotebookDoc, NotebookVariableDetail, NotebookVariableLookup, NotebookVariables, NotebookVariable } from "../types";
import { existingKernel, type KernelCellReply, type KernelSession } from "./kernels";

/*
 * Reads the user variables of a notebook's running Python kernel, the way VS Code's Jupyter extension fills its
 * Variables view: a quiet execution (no history, no execution count) that prints JSON. It never starts a kernel.
 */

const MARKER = "__NF_VARIABLES__";
/** Variables listed at most; the rest are counted in `total`. */
export const VARIABLE_LIST_LIMIT = 200;
const PREVIEW_CHARS = 80;
const DETAIL_CHARS = 4_000;

/** Python identifiers only, so the name can go into the probe as a plain string. */
export const VARIABLE_NAME = /^[\p{L}_][\p{L}\p{N}_]*$/u;

/**
 * Probe code. It defines one private helper, prints one marker line, and deletes the helper. Types hidden by
 * default match VS Code's `jupyter.variableExplorerExclude`; names come from `%who` (no `_` names, no IPython's own).
 */
export function variablesProbe(name?: string): string {
  const args = [name === undefined ? "None" : JSON.stringify(name), VARIABLE_LIST_LIMIT, PREVIEW_CHARS, DETAIL_CHARS].join(", ");
  return String.raw`
def __nf_variables(target, limit, preview, detail):
    import json, reprlib
    try:
        shell = get_ipython()
        ns, hidden = shell.user_ns, shell.user_ns_hidden
    except NameError:
        ns, hidden = globals(), {}
    skip = {"module", "function", "builtin_function_or_method", "ABCMeta", "type", "ModelMetaclass"}
    missing = object()

    def text(value, chars):
        brief = reprlib.Repr()
        brief.maxstring = brief.maxother = brief.maxlong = chars
        brief.maxlist = brief.maxtuple = brief.maxset = brief.maxdict = 100 if chars > preview else 10
        try:
            out = brief.repr(value)
        except Exception as error:
            out = "<repr 失败：%s>" % type(error).__name__
        return out if len(out) <= chars else out[:chars] + "…"

    def entry(key, value):
        row = {"name": key, "type": type(value).__name__, "preview": text(value, preview)}
        try:
            shape = getattr(value, "shape", None)
            if isinstance(shape, tuple):
                row["size"] = "×".join(str(part) for part in shape) or "()"
            elif hasattr(value, "__len__"):
                row["size"] = "len %d" % len(value)
        except Exception:
            pass
        return row

    if target is None:
        names = sorted(key for key, value in list(ns.items())
                       if not key.startswith("_") and value is not hidden.get(key, missing)
                       and type(value).__name__ not in skip)
        rows = [entry(key, ns[key]) for key in names[:limit]]
        print(${JSON.stringify(MARKER)} + json.dumps({"variables": rows, "total": len(names)}, ensure_ascii=False))
        return
    if target not in ns:
        print(${JSON.stringify(MARKER)} + json.dumps({"found": False}))
        return
    value = ns[target]
    row = entry(target, value)
    full = text(value, detail)
    row["repr"] = full
    if len(full) >= detail:
        row["truncated"] = True
    try:
        dtype = getattr(value, "dtype", None)
        if dtype is not None:
            row["dtype"] = str(dtype)
        dtypes = getattr(value, "dtypes", None)
        if dtypes is not None and hasattr(value, "columns"):
            row["columns"] = [{"name": str(col), "dtype": str(kind)} for col, kind in list(dtypes.items())[:50]]
    except Exception:
        pass
    print(${JSON.stringify(MARKER)} + json.dumps({"found": True, "variable": row}, ensure_ascii=False))

try:
    __nf_variables(${args})
finally:
    del __nf_variables
`;
}

/** The JSON the probe printed, or an error naming what went wrong. */
export function parseProbe<T>(reply: KernelCellReply): T {
  let stdout = "";
  for (const output of reply.outputs as { outputType?: string; name?: string; text?: string; traceback?: string }[]) {
    if (output.outputType === "error") throw new Error(`读取变量失败：${(output.traceback ?? "").split("\n").pop()}`);
    if (output.outputType === "stream" && output.name === "stdout") stdout += output.text ?? "";
  }
  const line = stdout.split("\n").find((item) => item.startsWith(MARKER));
  if (!line) throw new Error("读取变量失败：内核没有返回结果");
  return JSON.parse(line.slice(MARKER.length)) as T;
}

/** Why this notebook has no variables to read right now, or the kernel to read them from. */
export function variableSource(notebook: NotebookDoc, session = existingKernel(notebook.id)): { reason: string } | { session: KernelSession } {
  if (notebook.language !== "python") return { reason: "R 笔记本暂不支持列出变量。" };
  if (process.env.NEXTFLOW_STUDIO_KERNEL === "oneshot") return { reason: "没有常驻内核：单元格每次从头运行，运行完不保留变量。" };
  if (!session || session.state === "dead") return { reason: "内核还没启动。运行一个代码单元格后才有变量。" };
  if (session.requested !== notebook.kernel) return { reason: "笔记本换了内核，下次运行单元格时会重启，之前的变量不再可用。" };
  if (session.state === "starting") return { reason: "内核正在启动。" };
  if (session.state === "busy") return { reason: "内核正在运行单元格，等它结束再读变量。" };
  return { session };
}

export async function listNotebookVariables(notebook: NotebookDoc, session?: KernelSession): Promise<NotebookVariables> {
  const source = variableSource(notebook, session ?? existingKernel(notebook.id));
  if ("reason" in source) return { available: false, reason: source.reason, variables: [] };
  try {
    const reply = await source.session.execute(variablesProbe(), { quiet: true });
    const { variables, total } = parseProbe<{ variables: NotebookVariable[]; total: number }>(reply);
    return { available: true, ...(source.session.kernel && { kernel: source.session.kernel }), variables, total };
  } catch (error) {
    return { available: false, reason: error instanceof Error ? error.message : String(error), variables: [] };
  }
}

export async function readNotebookVariable(notebook: NotebookDoc, name: string, session?: KernelSession): Promise<NotebookVariableLookup> {
  if (!VARIABLE_NAME.test(name)) throw new Error(`变量名无效：${name}`);
  const source = variableSource(notebook, session ?? existingKernel(notebook.id));
  if ("reason" in source) return { available: false, reason: source.reason };
  try {
    const reply = await source.session.execute(variablesProbe(name), { quiet: true });
    const result = parseProbe<{ found: boolean; variable?: NotebookVariableDetail }>(reply);
    return result.found && result.variable ? { available: true, found: true, variable: result.variable } : { available: true, found: false, name };
  } catch (error) {
    return { available: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
