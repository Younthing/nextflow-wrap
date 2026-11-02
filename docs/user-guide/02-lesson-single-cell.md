# 第一课：单细胞（PBMC 3k）

目标：两个 scanpy 笔记本 → 两个模块 → 一条流程，跑出聚类 UMAP 和每簇 marker 基因。约 15 分钟。

## 准备数据

任选一种：

- 已有原始计数的 `.h5ad`：直接用它的路径。
- 让脚本准备：`python3 scripts/make-pbmc-demo.py ~/nfs-demo/pbmc3k.h5ad`（先尝试下载 10x PBMC 3k，约 6 MB；离线时生成形状相似的模拟数据）。

需要 Python 里有 scanpy、igraph、leidenalg、ipykernel（首次启动向导的「创建笔记本环境」已包含）。

## 1. 质控笔记本

笔记本 → 新建笔记本，命名 `scanpy_qc`，写三个单元格：

```python
# @input name=adata type=path required
# @input name=min_genes type=int default=200
adata = "/Users/me/nfs-demo/pbmc3k.h5ad"
min_genes = 200
```

```python
import scanpy as sc
ad = sc.read_h5ad(adata)
ad.var_names_make_unique()
ad.var["mt"] = ad.var_names.str.upper().str.startswith("MT-")
sc.pp.calculate_qc_metrics(ad, qc_vars=["mt"], inplace=True, percent_top=None, log1p=False)
sc.pp.filter_cells(ad, min_genes=min_genes)
sc.pp.filter_genes(ad, min_cells=3)
ad = ad[ad.obs.pct_counts_mt < 20].copy()
print(f"kept {ad.n_obs} cells")
```

```python
# @output name=filtered type=path pattern=filtered.h5ad
# @output name=qc_plot type=path pattern=qc.png
import matplotlib.pyplot as plt
fig, axis = plt.subplots(figsize=(4, 3))
axis.hist(ad.obs.n_genes_by_counts, bins=40)
fig.savefig("qc.png", dpi=80)
ad.write_h5ad("filtered.h5ad")
```

把第一个单元格标为「输入」，最后一个标为「输出」。路径框旁边的文件夹按钮可以打开系统文件对话框，也可以把文件从 Finder 拖进来。
逐个运行单元格：它们在同一个常驻内核里执行，后面的单元格能用前面的变量。

## 2. 发布为模块

点「发布为模块…」：

1. 转化预览：检查生成的命令行参数（`--adata`、`--min_genes`）和输出文件。
2. 试跑：给 `adata` 选「路径」并填数据文件，点「开始试跑」。它在独立目录里从头运行一遍，确认输出文件都生成了。
3. 保存为模块 v1。

## 3. 聚类笔记本

同样新建 `scanpy_cluster`，输入是 `filtered`，输出单元格做标准化、PCA、邻居图、UMAP、Leiden 聚类和 marker 基因，输出 `umap.png` 和 `markers.csv`。
完整代码见仓库 `e2e/single-cell.spec.ts` 里的 `CLUSTER_OUTPUT`。发布方法同上。

## 4. 连成流程并运行

1. 流程 → 新建，命名「单细胞」。
2. 从左侧模块库拖入「参考文件」，参数名填 `counts`，值填数据路径。
3. 从参考文件的输出端口拖一条线到空白处，搜索 `scanpy_qc` 选中，它会自动接上。
4. 从 `scanpy_qc` 的 `filtered` 输出再拖出一条线，选 `scanpy_cluster`。
5. 点「运行」，「容器 / 环境」选 Shell（用本机 Python），启动。

## 5. 看结果

运行页的「结果」标签按模块列出输出：`umap.png` 直接显示图，`markers.csv` 显示为表格，`.h5ad` 显示细胞数、基因数、obs 列、嵌入（obsm）等摘要，不用把整个文件读进浏览器。
每个结果旁边能看到它来自哪个节点、哪个模块版本、哪次笔记本修订；「带回笔记本」会复制一段读取这个文件的代码。

改了笔记本想再跑：发布 v2 → 画布上节点会提示有新版本 → 切换后点运行对话框里的「续跑」，没变的步骤直接用缓存。
