import { bridgePython } from "@/features/notebook/server/kernels";
import { CommandError, runCommand } from "@/features/project/server/command";
import type { AnnDataSummary } from "../anndata";
import { HttpError } from "./service";

/**
 * Reads only HDF5 metadata with h5py, so a multi-gigabyte file is summarised in well under a second and
 * neither scanpy nor anndata has to be installed. Handles the on-disk format of anndata 0.7 and later.
 */
const SCRIPT = String.raw`
import json, sys
import h5py

def text(value):
    return value.decode() if isinstance(value, bytes) else str(value)

def names(group, limit=3):
    index = text(group.attrs.get("_index", "_index"))
    if index not in group:
        return 0, []
    data = group[index]
    return data.shape[0], [text(v) for v in data[:limit]]

def columns(group):
    out = []
    order = [text(c) for c in group.attrs.get("column-order", [])] or [k for k in group.keys() if k not in (text(group.attrs.get("_index", "_index")), "__categories")]
    legacy = group.get("__categories")
    for name in order:
        if name not in group:
            continue
        item = group[name]
        if isinstance(item, h5py.Group) and "categories" in item:
            levels = item["categories"]
            out.append({"name": name, "dtype": "category", "categories": [text(v) for v in levels[:12]], "categoryCount": int(levels.shape[0])})
        elif legacy is not None and name in legacy:
            levels = legacy[name]
            out.append({"name": name, "dtype": "category", "categories": [text(v) for v in levels[:12]], "categoryCount": int(levels.shape[0])})
        elif isinstance(item, h5py.Dataset):
            kind = text(item.attrs.get("encoding-type", ""))
            out.append({"name": name, "dtype": "string" if kind.startswith("string") or item.dtype.kind in "OSU" else str(item.dtype)})
        else:
            out.append({"name": name, "dtype": text(item.attrs.get("encoding-type", "group"))})
    return out

with h5py.File(sys.argv[1], "r") as f:
    n_obs, obs_names = names(f["obs"]) if "obs" in f else (0, [])
    n_vars, var_names = names(f["var"]) if "var" in f else (0, [])
    matrix = "missing"
    if "X" in f:
        x = f["X"]
        if isinstance(x, h5py.Dataset):
            matrix = "dense " + str(x.dtype)
            n_obs, n_vars = n_obs or x.shape[0], n_vars or x.shape[1]
        else:
            matrix = text(x.attrs.get("encoding-type", x.attrs.get("h5sparse_format", "sparse"))) + " " + str(x["data"].dtype)
            if "shape" in x.attrs:
                n_obs, n_vars = n_obs or int(x.attrs["shape"][0]), n_vars or int(x.attrs["shape"][1])
    obsm = []
    if "obsm" in f:
        for key, value in f["obsm"].items():
            shape = list(value.shape) if isinstance(value, h5py.Dataset) else [int(v) for v in value.attrs.get("shape", [])]
            obsm.append({"name": key, "shape": shape})
    print(json.dumps({
        "nObs": int(n_obs), "nVars": int(n_vars), "matrix": matrix,
        "obs": columns(f["obs"]) if "obs" in f else [], "var": columns(f["var"]) if "var" in f else [],
        "obsm": obsm, "layers": list(f["layers"].keys()) if "layers" in f else [],
        "uns": sorted(f["uns"].keys()) if "uns" in f else [],
        "obsNames": obs_names, "varNames": var_names,
    }))
`;

export async function summarizeAnnData(path: string, python = bridgePython()): Promise<AnnDataSummary> {
  try {
    const output = await runCommand(python, ["-c", SCRIPT, path], { quiet: true, timeoutMs: 60_000 });
    return JSON.parse(output.slice(output.indexOf("{"))) as AnnDataSummary;
  } catch (error) {
    const message = error instanceof CommandError ? error.output : error instanceof Error ? error.message : String(error);
    if (/No module named ['"]?h5py/.test(message)) throw new HttpError(422, `${python} 里没有 h5py。运行 ${python} -m pip install h5py，或在设置页指定装有 scanpy 的 Python`);
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new HttpError(422, `找不到 Python（${python}）`);
    throw new HttpError(422, `无法读取 h5ad：${message.trim().split("\n").at(-1) ?? message}`);
  }
}
