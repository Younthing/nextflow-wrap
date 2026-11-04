import type { WorkflowDoc } from "@/features/workflow/types";
import { FILE_ID } from "@/features/workflow/builtins";
import { IF_EXAMPLE_PROJECT_ID } from "@/features/workspace/projects";
import { cells, edge, EXAMPLE_TIME, node, stepNotebooks, type ExampleStep } from "./examples";
import type { NotebookDoc } from "./types";

/**
 * The immunofluorescence example project: five Python notebooks (scikit-image, scipy, scikit-learn, pandas,
 * matplotlib) that take one multi-channel IF image from background removal to nucleus segmentation, per-cell
 * measurements and a clustered summary, each exported as a module, and a workflow that chains them. CPU only.
 *
 * The image is a BBBC022 crop (U2OS Cell Painting, Broad Bioimage Benchmark Collection; Y×X×C, channel 0 is Hoechst).
 * The chain follows `fixtures/fluora/smoke_main_pipeline.py --no-gpu`.
 */

const IO_SETUP = `import numpy as np
from skimage import io
`;

const ifPreprocess = cells(
  ["markdown", "# 背景扣除与去噪\n\n读取多通道免疫荧光图像，取细胞核通道，扣除大尺度高斯背景后再做高斯去噪。\n"],
  ["input", `# @input name=image type=path required
# @input name=nuclei_channel type=int default=0
# @input name=background_sigma type=float default=50
# @input name=smooth_sigma type=float default=2
image = "data/image.tif"
nuclei_channel = 0
background_sigma = 50.0
smooth_sigma = 2.0
`],
  ["code", `${IO_SETUP}from skimage import filters

img = io.imread(image)
if img.ndim == 2:
    img = img[..., None]
if img.ndim != 3 or nuclei_channel >= img.shape[-1]:
    raise SystemExit(f"需要 Y×X×C 的多通道图像，实际形状：{img.shape}")
print(f"图像 {img.shape} {img.dtype}")
nuc = img[..., nuclei_channel].astype(np.float32)
background = filters.gaussian(nuc, sigma=background_sigma, preserve_range=True)
filtered = filters.gaussian(np.clip(nuc - background, 0, None), sigma=smooth_sigma, preserve_range=True).astype(np.float32)
`],
  ["explore", `float(filtered.min()), float(filtered.mean()), float(filtered.max())
`],
  ["output", `# @output name=filtered type=path pattern="nuclei_filtered.tif"
io.imsave("nuclei_filtered.tif", filtered, check_contrast=False)
`],
);

const ifSegment = cells(
  ["markdown", "# 细胞核分割\n\nOtsu 阈值得到前景，距离变换的局部极大值作种子，分水岭拆开相邻细胞核（CPU，无需 GPU）。\n"],
  ["input", `# @input name=filtered type=path required
# @input name=min_distance type=int default=8
# @input name=distance_sigma type=float default=2
filtered = "nuclei_filtered.tif"
min_distance = 8
distance_sigma = 2.0
`],
  ["code", `${IO_SETUP}from scipy import ndimage as ndi
from skimage import feature, filters, measure, segmentation

nuc = io.imread(filtered).astype(np.float32)
mask = nuc > filters.threshold_otsu(nuc)
distance = ndi.distance_transform_edt(mask)
peaks = feature.peak_local_max(filters.gaussian(distance, distance_sigma), min_distance=min_distance, labels=measure.label(mask))
markers = np.zeros(mask.shape, dtype=np.int32)
markers[tuple(peaks.T)] = np.arange(1, len(peaks) + 1)
labels = segmentation.watershed(-distance, markers, mask=mask).astype(np.int32)
`],
  ["output", `# @output name=labels type=path pattern="nuclei_labels.tif"
io.imsave("nuclei_labels.tif", labels, check_contrast=False)
print(f"分割得到 {int(labels.max())} 个对象")
`],
);

const ifPostprocess = cells(
  ["markdown", "# 分割后处理\n\n去掉贴边和过小的对象，重新编号；把细胞核向外扩展，近似细胞体，用于胞质通道的测量。\n"],
  ["input", `# @input name=labels type=path required
# @input name=min_area type=int default=50
# @input name=expand_distance type=int default=8
labels = "nuclei_labels.tif"
min_area = 50
expand_distance = 8
`],
  ["code", `${IO_SETUP}from skimage import segmentation

nuclei = segmentation.clear_border(io.imread(labels).astype(np.int32))
areas = np.bincount(nuclei.ravel())
nuclei[np.isin(nuclei, np.where(areas < min_area)[0])] = 0
nuclei, _, _ = segmentation.relabel_sequential(nuclei)
cells = segmentation.expand_labels(nuclei, distance=expand_distance)
`],
  ["output", `# @output name=nuclei type=path pattern="nuclei_labels_clean.tif"
# @output name=cells type=path pattern="cell_labels.tif"
io.imsave("nuclei_labels_clean.tif", nuclei.astype(np.int32), check_contrast=False)
io.imsave("cell_labels.tif", cells.astype(np.int32), check_contrast=False)
print(f"保留 {int(nuclei.max())} 个细胞核")
`],
);

const ifMeasure = cells(
  ["markdown", "# 单细胞测量\n\n每个细胞核的形态学特征和核通道强度；其余通道在扩展后的细胞区域内取平均强度。\n"],
  ["input", `# @input name=nuclei type=path required
# @input name=cells type=path required
# @input name=image type=path required
# @input name=nuclei_channel type=int default=0
nuclei = "nuclei_labels_clean.tif"
cells = "cell_labels.tif"
image = "data/image.tif"
nuclei_channel = 0
`],
  ["code", `${IO_SETUP}import pandas as pd
from skimage import measure

nuc_labels = io.imread(nuclei).astype(np.int32)
cell_labels = io.imread(cells).astype(np.int32)
img = io.imread(image)
if img.ndim == 2:
    img = img[..., None]
props = ("label", "area", "perimeter", "eccentricity", "solidity", "major_axis_length", "minor_axis_length", "centroid", "mean_intensity", "max_intensity")
table = pd.DataFrame(measure.regionprops_table(nuc_labels, intensity_image=img[..., nuclei_channel], properties=props))
table = table.rename(columns={"mean_intensity": "nuclei_mean", "max_intensity": "nuclei_max", "centroid-0": "y", "centroid-1": "x"})
for channel in range(img.shape[-1]):
    if channel == nuclei_channel:
        continue
    per_cell = pd.DataFrame(measure.regionprops_table(cell_labels, intensity_image=img[..., channel], properties=("label", "mean_intensity")))
    table = table.merge(per_cell.rename(columns={"mean_intensity": f"ch{channel}_cell_mean"}), on="label", how="left")
cell_area = pd.DataFrame(measure.regionprops_table(cell_labels, properties=("label", "area"))).rename(columns={"area": "cell_area"})
table = table.merge(cell_area, on="label", how="left")
table["circularity"] = 4 * np.pi * table["area"] / table["perimeter"].clip(lower=1) ** 2
`],
  ["explore", `table.describe().T
`],
  ["output", `# @output name=features type=path pattern="features.csv"
table.round(4).to_csv("features.csv", index=False)
print(f"{len(table)} 个细胞，{table.shape[1]} 列特征")
`],
);

const ifSummarize = cells(
  ["markdown", "# 统计与聚类\n\n特征的描述统计，标准化后 KMeans 聚类，汇总成一张总览图：合成图、分割叠加、面积分布、聚类和通道强度。\n"],
  ["input", `# @input name=features type=path required
# @input name=image type=path required
# @input name=nuclei type=path required
# @input name=cells type=path required
# @input name=n_clusters type=int default=3
# @input name=nuclei_channel type=int default=0
features = "features.csv"
image = "data/image.tif"
nuclei = "nuclei_labels_clean.tif"
cells = "cell_labels.tif"
n_clusters = 3
nuclei_channel = 0
`],
  ["code", `import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
${IO_SETUP}import pandas as pd
from skimage import exposure, segmentation
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler

table = pd.read_csv(features)
img = io.imread(image)
if img.ndim == 2:
    img = img[..., None]
nuc_labels = io.imread(nuclei).astype(np.int32)
cell_labels = io.imread(cells).astype(np.int32)
channel_cols = [col for col in table.columns if col.endswith("_cell_mean")]
feature_cols = ["area", "eccentricity", "solidity", "circularity", "nuclei_mean", *channel_cols]
k = min(n_clusters, len(table)) if len(table) >= 2 * n_clusters else 1
table["cluster"] = KMeans(n_clusters=k, n_init=10, random_state=0).fit_predict(StandardScaler().fit_transform(table[feature_cols])) if len(table) else []
`],
  ["output", `# @output name=stats type=path pattern="stats.csv"
# @output name=overview type=path pattern="overview.png"
stats = table[feature_cols].describe().T
stats.round(4).to_csv("stats.csv", index_label="feature")

others = [c for c in range(img.shape[-1]) if c != nuclei_channel][:2]
order = [*others[::-1], nuclei_channel]
rgb = np.dstack([exposure.rescale_intensity(img[..., c].astype(float), out_range=(0, 1)) for c in order] + [np.zeros(img.shape[:2])] * (3 - len(order)))
fig, ax = plt.subplots(2, 3, figsize=(15, 9), constrained_layout=True)
ax[0, 0].imshow(rgb)
ax[0, 0].set_title("composite")
ax[0, 1].imshow(segmentation.mark_boundaries(rgb, cell_labels, color=(1, 1, 0)))
ax[0, 1].imshow(np.ma.masked_equal(nuc_labels, 0), cmap="nipy_spectral", alpha=0.45)
ax[0, 1].set_title(f"{len(table)} nuclei + cell outlines")
ax[0, 2].imshow(img[..., nuclei_channel], cmap="gray")
ax[0, 2].scatter(table["x"], table["y"], c=table["cluster"], cmap="tab10", s=14)
ax[0, 2].set_title("clusters on nuclei channel")
ax[1, 0].hist(table["area"], bins=25)
ax[1, 0].set_title("nucleus area (px)")
y_col = channel_cols[0] if channel_cols else "solidity"
ax[1, 1].scatter(table["nuclei_mean"], table[y_col], c=table["cluster"], cmap="tab10")
ax[1, 1].set_xlabel("nuclei mean")
ax[1, 1].set_ylabel(y_col)
ax[1, 1].set_title(f"KMeans (k={k})")
table.boxplot(column=["nuclei_mean", *channel_cols], ax=ax[1, 2])
ax[1, 2].set_title("channel intensities")
for axis in ax[0]:
    axis.axis("off")
fig.savefig("overview.png", dpi=120)
print(f"{len(table)} 个细胞，{k} 类：{table['cluster'].value_counts().sort_index().to_dict()}")
`],
);

const IF_STEPS: ExampleStep[] = [
  { id: "if_preprocess", name: "if_preprocess", description: "免疫荧光：细胞核通道背景扣除与高斯去噪", cells: ifPreprocess },
  { id: "if_segment", name: "if_segment", description: "免疫荧光：Otsu 阈值 + 距离分水岭分割细胞核（CPU）", cells: ifSegment },
  { id: "if_postprocess", name: "if_postprocess", description: "免疫荧光：去贴边、去碎片、扩展为细胞区域", cells: ifPostprocess },
  { id: "if_measure", name: "if_measure", description: "免疫荧光：单细胞形态与多通道强度测量", cells: ifMeasure },
  { id: "if_summarize", name: "if_summarize", description: "免疫荧光：描述统计、KMeans 聚类与总览图", cells: ifSummarize },
];

export const IF_EXAMPLE_MODULE_IDS = IF_STEPS.map((step) => `script/${step.id}`);

/** Keywords on the IF example modules, for the module library search. */
export const IF_EXAMPLE_KEYWORDS = ["notebook", "scikit-image", "immunofluorescence"];

/** Workspace path of the example image, and its file shipped with the app (under `public/`). */
export const IF_EXAMPLE_IMAGE = { path: "data/image.tif", asset: ["public", "examples", "if", "IXMtest_A02_s9.tif"] } as const;

/** The IF example project's notebooks. */
export function ifExampleNotebooks(projectId = IF_EXAMPLE_PROJECT_ID): NotebookDoc[] {
  return stepNotebooks(IF_STEPS, projectId);
}

/** The five IF modules chained on the example image. The original image also feeds measurement and the summary. */
export function ifExampleWorkflow(projectId = IF_EXAMPLE_PROJECT_ID): WorkflowDoc {
  return {
    id: "example_if",
    name: "免疫荧光分析示例",
    description: "背景扣除 → 细胞核分割 → 后处理 → 单细胞测量 → 统计与聚类",
    version: 1,
    params: { outdir: "results" },
    projectId,
    nodes: [
      node("image", FILE_ID, "IMAGE", 0, 200, { config: {}, settings: { path: IF_EXAMPLE_IMAGE.path } }),
      node("pre", "script/if_preprocess", "IF_PREPROCESS", 380, 80, { widgets: { nuclei_channel: 0, background_sigma: 50, smooth_sigma: 2 } }),
      node("seg", "script/if_segment", "IF_SEGMENT", 780, 80, { widgets: { min_distance: 8, distance_sigma: 2 } }),
      node("post", "script/if_postprocess", "IF_POSTPROCESS", 1180, 80, { widgets: { min_area: 50, expand_distance: 8 } }),
      node("measure", "script/if_measure", "IF_MEASURE", 1580, 200, { widgets: { nuclei_channel: 0 } }),
      node("summary", "script/if_summarize", "IF_SUMMARIZE", 1980, 200, { widgets: { n_clusters: 3, nuclei_channel: 0 } }),
    ],
    edges: [
      edge("image", "file", "pre", "image"),
      edge("pre", "filtered", "seg", "filtered"),
      edge("seg", "labels", "post", "labels"),
      edge("post", "nuclei", "measure", "nuclei"),
      edge("post", "cells", "measure", "cells"),
      edge("image", "file", "measure", "image"),
      edge("measure", "features", "summary", "features"),
      edge("image", "file", "summary", "image"),
      edge("post", "nuclei", "summary", "nuclei"),
      edge("post", "cells", "summary", "cells"),
    ],
    updatedAt: EXAMPLE_TIME,
  };
}
