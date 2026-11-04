import type { WorkflowDoc } from "@/features/workflow/types";
import { FILE_ID } from "@/features/workflow/builtins";
import { IF_EXAMPLE_PROJECT_ID } from "@/features/workspace/projects";
import { cells, edge, EXAMPLE_TIME, node, stepNotebooks, type ExampleStep } from "./examples";
import type { NotebookDoc } from "./types";

/**
 * Side branches of the immunofluorescence example, following the BioImageAnalysisNotebooks chapters that run
 * headless: label morphology, neighbourhoods, object classification and colocalisation on the main chain's labels,
 * plus membrane segmentation, blob detection, APOC pixel classification and intensity over time on their own images.
 * CPU only; only `if_pixel_clf_apoc` needs `apoc` (pyclesperanto, OpenCL on the CPU through PoCL).
 */

const IO_SETUP = `import numpy as np
from skimage import io
`;

const PLOT_SETUP = `import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
`;

const ifMorphExtra = cells(
  ["markdown", "# 标签形态学\n\n对分割结果逐标签做形态学处理：开运算去毛刺、闭运算补缺口、腐蚀后按连通性拆分、只留边缘、骨架化，或用距离分水岭拆开粘连对象。\n"],
  ["input", `# @input name=labels type=path required
# @input name=op type=str default="open"
# @input name=radius type=int default=2
labels = "nuclei_labels_clean.tif"
op = "open"
radius = 2
`],
  ["code", `${IO_SETUP}from scipy import ndimage as ndi
from skimage import feature, filters, measure, morphology, segmentation

OPS = ("open", "close", "erode_connected", "edges", "skeleton", "split_touching")
if op not in OPS:
    raise SystemExit(f"op 需为 {', '.join(OPS)} 之一，实际：{op}")
lab = io.imread(labels).astype(np.int32)


def erode(image, steps):
    out = image.copy()
    for _ in range(steps):
        out[segmentation.find_boundaries(out, mode="inner")] = 0
    return out


if op == "open":
    refined = segmentation.expand_labels(erode(lab, radius), distance=radius)
    refined = np.where(refined == lab, refined, 0)
elif op == "close":
    refined = np.where(lab > 0, lab, erode(segmentation.expand_labels(lab, distance=radius), radius))
elif op == "erode_connected":
    pieces = measure.label(erode(lab, radius), connectivity=1)
    refined = np.where(lab > 0, segmentation.expand_labels(pieces, distance=radius), 0)
elif op == "edges":
    refined = np.where(segmentation.find_boundaries(lab, mode="inner"), lab, 0)
elif op == "skeleton":
    refined = np.zeros_like(lab)
    for region in measure.regionprops(lab):
        refined[region.slice][morphology.skeletonize(region.image)] = region.label
else:
    mask = lab > 0
    distance = ndi.distance_transform_edt(mask)
    peaks = feature.peak_local_max(filters.gaussian(distance, 1), min_distance=max(3 * radius, 3), labels=measure.label(mask))
    markers = np.zeros(mask.shape, dtype=np.int32)
    markers[tuple(peaks.T)] = np.arange(1, len(peaks) + 1)
    refined = segmentation.watershed(-distance, markers, mask=mask)
if op not in ("edges", "skeleton"):
    refined, _, _ = segmentation.relabel_sequential(refined.astype(np.int32))
before, after = len(np.unique(lab)) - 1, len(np.unique(refined)) - 1
`],
  ["output", `# @output name=refined type=path pattern="labels_refined.tif"
io.imsave("labels_refined.tif", refined.astype(np.int32), check_contrast=False)
print(f"{op}（radius={radius}）：{before} → {after} 个对象，前景 {int((lab > 0).sum())} → {int((refined > 0).sum())} 像素")
`],
);

const ifNeighbors = cells(
  ["markdown", "# 邻域分析\n\n统计每个细胞接触的邻居数、给定距离内的邻居数和最近邻距离，输出邻居计数图和邻接网格图。用扩展后的细胞标签时接触关系最直观。\n"],
  ["input", `# @input name=labels type=path required
# @input name=max_distance type=float default=60
# @input name=n_nearest type=int default=3
labels = "cell_labels.tif"
max_distance = 60.0
n_nearest = 3
`],
  ["code", `${PLOT_SETUP}${IO_SETUP}import pandas as pd
from scipy.spatial import cKDTree
from skimage import measure, segmentation

lab = io.imread(labels).astype(np.int32)
table = pd.DataFrame(measure.regionprops_table(lab, properties=("label", "area", "centroid")))
table = table.rename(columns={"centroid-0": "y", "centroid-1": "x"})
pairs = []
for a, b in ((lab[:, :-1], lab[:, 1:]), (lab[:-1, :], lab[1:, :])):
    touching = (a != b) & (a > 0) & (b > 0)
    pairs.append(np.sort(np.stack([a[touching], b[touching]], axis=1), axis=1))
pairs = np.unique(np.concatenate(pairs), axis=0) if pairs else np.zeros((0, 2), dtype=int)
touch = pd.Series(np.concatenate([pairs[:, 0], pairs[:, 1]])).value_counts()
table["touching_neighbors"] = table["label"].map(touch).fillna(0).astype(int)
points = table[["y", "x"]].to_numpy()
if len(table) > 1:
    tree = cKDTree(points)
    k = min(n_nearest, len(table) - 1)
    dist, _ = tree.query(points, k=k + 1)
    table["nearest_distance"] = dist[:, 1]
    table[f"mean_distance_{k}_nearest"] = dist[:, 1:].mean(axis=1)
    table["proximal_neighbors"] = [len(found) - 1 for found in tree.query_ball_point(points, r=max_distance)]
else:
    table["nearest_distance"] = np.nan
    table["proximal_neighbors"] = 0
lookup = np.zeros(int(lab.max()) + 1, dtype=np.float32)
lookup[table["label"].to_numpy()] = table["touching_neighbors"].to_numpy()
count_map = lookup[lab]
`],
  ["explore", `table.describe().T
`],
  ["output", `# @output name=counts type=path pattern="neighbor_counts.csv"
# @output name=neighbor_map type=path pattern="neighbor_map.tif"
# @output name=mesh type=path pattern="neighbor_mesh.png"
table.round(3).to_csv("neighbor_counts.csv", index=False)
io.imsave("neighbor_map.tif", count_map, check_contrast=False)
centers = dict(zip(table["label"], zip(table["x"], table["y"])))
fig, ax = plt.subplots(1, 2, figsize=(12, 6), constrained_layout=True)
ax[0].imshow(segmentation.find_boundaries(lab), cmap="gray_r")
for a, b in pairs:
    (xa, ya), (xb, yb) = centers[a], centers[b]
    ax[0].plot([xa, xb], [ya, yb], color="tab:red", linewidth=1)
ax[0].scatter(table["x"], table["y"], s=10, color="tab:blue")
ax[0].set_title(f"touching mesh: {len(pairs)} contacts")
shown = ax[1].imshow(np.ma.masked_equal(np.where(lab > 0, count_map, -1), -1), cmap="viridis")
fig.colorbar(shown, ax=ax[1], shrink=0.8)
ax[1].set_title("touching neighbour count")
for axis in ax:
    axis.axis("off")
fig.savefig("neighbor_mesh.png", dpi=110)
print(f"{len(table)} 个对象，{len(pairs)} 对接触；平均接触邻居 {table['touching_neighbors'].mean():.2f}，{max_distance:g} px 内平均邻居 {table['proximal_neighbors'].mean():.2f}")
`],
);

const ifObjectClf = cells(
  ["markdown", "# 物体分类\n\n逐对象提取形态与各通道强度特征，用随机森林分类。给了标注图（对象上画的类别号）就用标注训练；没有标注时用 KMeans 聚类结果作弱标签，交叉验证报告一致性。\n"],
  ["input", `# @input name=image type=path required
# @input name=labels type=path required
# @input name=annotation type=str default=""
# @input name=n_classes type=int default=3
# @input name=n_trees type=int default=100
image = "data/image.tif"
labels = "nuclei_labels_clean.tif"
annotation = ""
n_classes = 3
n_trees = 100
`],
  ["code", `${IO_SETUP}import os
import pandas as pd
from skimage import measure
from sklearn.cluster import KMeans
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import cross_val_predict
from sklearn.preprocessing import StandardScaler

img = io.imread(image)
if img.ndim == 2:
    img = img[..., None]
lab = io.imread(labels).astype(np.int32)
props = ("label", "area", "perimeter", "eccentricity", "solidity", "extent", "major_axis_length", "minor_axis_length", "centroid", "mean_intensity")
table = pd.DataFrame(measure.regionprops_table(lab, intensity_image=img, properties=props))
table = table.rename(columns={"centroid-0": "y", "centroid-1": "x", **{f"mean_intensity-{c}": f"ch{c}_mean" for c in range(img.shape[-1])}})
table["circularity"] = 4 * np.pi * table["area"] / table["perimeter"].clip(lower=1) ** 2
feature_cols = [c for c in table.columns if c not in ("label", "y", "x")]
X = StandardScaler().fit_transform(table[feature_cols])
if annotation and os.path.exists(annotation):
    ann = io.imread(annotation).astype(np.int32)
    drawn = pd.DataFrame(measure.regionprops_table(lab, intensity_image=ann, properties=("label", "max_intensity")))
    table["training_label"] = table["label"].map(dict(zip(drawn["label"], drawn["max_intensity"]))).fillna(0).astype(int)
    source = "annotation"
else:
    k = max(1, min(n_classes, len(table) // 2))
    table["training_label"] = KMeans(n_clusters=k, n_init=10, random_state=0).fit_predict(X) + 1 if len(table) else []
    source = "kmeans"
train = table["training_label"].to_numpy() > 0
if train.sum() < 2 or len(np.unique(table.loc[train, "training_label"])) < 2:
    raise SystemExit(f"训练样本不足：{int(train.sum())} 个已标注对象，至少需要两类")
clf = RandomForestClassifier(n_estimators=n_trees, random_state=0).fit(X[train], table.loc[train, "training_label"])
table["predicted_class"] = clf.predict(X)
table["probability"] = clf.predict_proba(X).max(axis=1)
smallest = int(table.loc[train, "training_label"].value_counts().min())
agreement = None
if smallest >= 2:
    cv = cross_val_predict(RandomForestClassifier(n_estimators=n_trees, random_state=0), X[train], table.loc[train, "training_label"], cv=min(5, smallest))
    agreement = float((cv == table.loc[train, "training_label"].to_numpy()).mean())
importance = pd.Series(clf.feature_importances_, index=feature_cols).sort_values(ascending=False)
lookup = np.zeros(int(lab.max()) + 1, dtype=np.uint8)
lookup[table["label"].to_numpy()] = table["predicted_class"].to_numpy()
class_map = lookup[lab]
`],
  ["explore", `importance.head(8)
`],
  ["output", `# @output name=classes type=path pattern="object_classes.csv"
# @output name=class_map type=path pattern="class_map.tif"
table.round(4).to_csv("object_classes.csv", index=False)
io.imsave("class_map.tif", class_map, check_contrast=False)
note = f"，交叉验证一致率 {agreement:.2f}" if agreement is not None else ""
print(f"{len(table)} 个对象（{source} 训练 {int(train.sum())} 个）→ 各类：{table['predicted_class'].value_counts().sort_index().to_dict()}{note}；最重要特征 {importance.index[0]}")
`],
);

const ifColoc = cells(
  ["markdown", "# 共定位分析\n\n在每个细胞区域内计算两个通道的 Pearson 相关和 Manders 系数；按细胞核内平均强度的 Otsu 阈值判定各通道阳性，统计双阳性细胞。\n"],
  ["input", `# @input name=image type=path required
# @input name=nuclei type=path required
# @input name=cells type=path required
# @input name=channel_a type=int default=1
# @input name=channel_b type=int default=2
image = "data/image.tif"
nuclei = "nuclei_labels_clean.tif"
cells = "cell_labels.tif"
channel_a = 1
channel_b = 2
`],
  ["code", `${PLOT_SETUP}${IO_SETUP}import pandas as pd
from scipy import ndimage as ndi
from skimage import filters, measure

img = io.imread(image)
if img.ndim != 3 or max(channel_a, channel_b) >= img.shape[-1]:
    raise SystemExit(f"需要至少 {max(channel_a, channel_b) + 1} 个通道的 Y×X×C 图像，实际形状：{img.shape}")
nuc = io.imread(nuclei).astype(np.int32)
cell = io.imread(cells).astype(np.int32)
a = img[..., channel_a].astype(np.float64)
b = img[..., channel_b].astype(np.float64)
# Otsu thresholds inside the cells, so bright debris outside them does not set the bar.
inside_cells = cell > 0
ta, tb = filters.threshold_otsu(a[inside_cells]), filters.threshold_otsu(b[inside_cells])
ids = np.unique(cell)
ids = ids[ids > 0]
rows = []
for label in ids:
    inside = cell == label
    va, vb = a[inside], b[inside]
    pearson = float(np.corrcoef(va, vb)[0, 1]) if va.std() > 0 and vb.std() > 0 else np.nan
    m1 = va[vb > tb].sum() / max(va.sum(), 1e-9)
    m2 = vb[va > ta].sum() / max(vb.sum(), 1e-9)
    overlap = float(((va > ta) & (vb > tb)).sum() / max(((va > ta) | (vb > tb)).sum(), 1))
    rows.append({"label": int(label), "cell_area": int(inside.sum()), "pearson": pearson, "manders_m1": m1, "manders_m2": m2, "overlap_jaccard": overlap})
table = pd.DataFrame(rows)
if len(table):
    table[f"ch{channel_a}_nuclear_mean"] = ndi.mean(a, labels=nuc, index=table["label"])
    table[f"ch{channel_b}_nuclear_mean"] = ndi.mean(b, labels=nuc, index=table["label"])
    for ch in (channel_a, channel_b):
        values = table[f"ch{ch}_nuclear_mean"]
        cut = filters.threshold_otsu(values.to_numpy()) if values.nunique() > 1 else values.max()
        table[f"ch{ch}_positive"] = values > cut
    table["double_positive"] = table[f"ch{channel_a}_positive"] & table[f"ch{channel_b}_positive"]
`],
  ["explore", `table.describe().T
`],
  ["output", `# @output name=table type=path pattern="coloc_table.csv"
# @output name=overview type=path pattern="coloc_overview.png"
table.round(4).to_csv("coloc_table.csv", index=False)
fig, ax = plt.subplots(1, 3, figsize=(16, 5), constrained_layout=True)
step = max(1, a.size // 20000)
ax[0].hexbin(a.ravel()[::step], b.ravel()[::step], gridsize=60, bins="log", cmap="magma")
ax[0].set_xlabel(f"ch{channel_a}")
ax[0].set_ylabel(f"ch{channel_b}")
ax[0].set_title("pixel scatter")
lookup = np.full(int(cell.max()) + 1, np.nan)
lookup[table["label"].to_numpy()] = table["pearson"].to_numpy()
shown = ax[1].imshow(np.where(cell > 0, lookup[cell], np.nan), cmap="coolwarm", vmin=-1, vmax=1)
fig.colorbar(shown, ax=ax[1], shrink=0.8)
ax[1].set_title("per-cell Pearson")
ax[1].axis("off")
ax[2].scatter(table[f"ch{channel_a}_nuclear_mean"], table[f"ch{channel_b}_nuclear_mean"], c=table["double_positive"].map({True: "tab:red", False: "tab:gray"}))
ax[2].set_xlabel(f"ch{channel_a} nuclear mean")
ax[2].set_ylabel(f"ch{channel_b} nuclear mean")
ax[2].set_title(f"double positive: {int(table['double_positive'].sum())}/{len(table)}")
fig.savefig("coloc_overview.png", dpi=110)
print(f"{len(table)} 个细胞：Pearson 中位数 {table['pearson'].median():.3f}，M1 {table['manders_m1'].mean():.3f}，M2 {table['manders_m2'].mean():.3f}，双阳性 {int(table['double_positive'].sum())}")
`],
);

const ifMembraneSeg = cells(
  ["markdown", "# 膜标记细胞分割\n\n膜染色图像上，细胞内部是暗的局部极小区域：高斯模糊后取局部极小值作种子，在轻度模糊的膜图上做分水岭，再去掉和空白背景一样暗的区域，得到细胞标签。\n"],
  ["input", `# @input name=membrane_image type=path required
# @input name=frame type=int default=0
# @input name=spot_sigma type=float default=6
# @input name=outline_sigma type=float default=2
# @input name=min_area type=int default=30
# @input name=background_factor type=float default=1.25
membrane_image = "data/membrane.tif"
frame = 0
spot_sigma = 6.0
outline_sigma = 2.0
min_area = 30
background_factor = 1.25
`],
  ["code", `${PLOT_SETUP}${IO_SETUP}from scipy import ndimage as ndi
from skimage import filters, measure, morphology, segmentation

stack = io.imread(membrane_image)
membrane = (stack[frame] if stack.ndim == 3 else stack).astype(np.float32)
spots = measure.label(morphology.local_minima(filters.gaussian(membrane, sigma=spot_sigma, preserve_range=True)))
outline = filters.gaussian(membrane, sigma=outline_sigma, preserve_range=True) if outline_sigma > 0 else membrane
cell_labels = segmentation.watershed(outline, spots).astype(np.int32)
areas = np.bincount(cell_labels.ravel())
small = np.isin(cell_labels, np.where(areas < min_area)[0])
cell_labels[small] = 0
cell_labels = segmentation.expand_labels(cell_labels, distance=max(3, int(np.sqrt(min_area))))
# Regions as dark as the empty background (median below background_factor × the 5th percentile) are not cells.
ids = np.unique(cell_labels)
ids = ids[ids > 0]
medians = ndi.median(membrane, labels=cell_labels, index=ids) if len(ids) else np.array([])
background = ids[medians < background_factor * np.percentile(membrane, 5)]
cell_labels[np.isin(cell_labels, background)] = 0
cell_labels, _, _ = segmentation.relabel_sequential(cell_labels)
area = np.bincount(cell_labels.ravel())[1:]
`],
  ["output", `# @output name=cells type=path pattern="membrane_cell_labels.tif"
# @output name=overview type=path pattern="membrane_overview.png"
io.imsave("membrane_cell_labels.tif", cell_labels, check_contrast=False)
fig, ax = plt.subplots(1, 2, figsize=(11, 5.5), constrained_layout=True)
ax[0].imshow(membrane, cmap="gray")
ax[0].set_title("membrane")
ax[1].imshow(segmentation.mark_boundaries(membrane / max(float(membrane.max()), 1.0), cell_labels, color=(1, 0.8, 0)))
ax[1].set_title(f"{int(cell_labels.max())} cells")
for axis in ax:
    axis.axis("off")
fig.savefig("membrane_overview.png", dpi=110)
print(f"{int(cell_labels.max())} 个细胞（去掉 {len(background)} 块背景），面积中位数 {float(np.median(area)) if len(area) else 0:.0f} px")
`],
);

const ifBlobDetect = cells(
  ["markdown", "# 斑点检测\n\n在单通道上用 LoG、DoG、DoH 或高斯平滑后的局部极大值检测斑点状结构（细胞核、颗粒），输出坐标、尺度和强度。\n"],
  ["input", `# @input name=image type=path required
# @input name=channel_index type=int default=0
# @input name=method type=str default="log"
# @input name=min_sigma type=float default=4
# @input name=max_sigma type=float default=12
# @input name=threshold type=float default=0.05
image = "data/image.tif"
channel_index = 0
method = "log"
min_sigma = 4.0
max_sigma = 12.0
threshold = 0.05
`],
  ["code", `${PLOT_SETUP}${IO_SETUP}import pandas as pd
from skimage import exposure, feature, filters

METHODS = ("log", "dog", "doh", "peaks")
if method not in METHODS:
    raise SystemExit(f"method 需为 {', '.join(METHODS)} 之一，实际：{method}")
img = io.imread(image)
plane = img[..., channel_index] if img.ndim == 3 else img
plane = exposure.rescale_intensity(plane.astype(np.float64), out_range=(0.0, 1.0))
if method == "log":
    found = feature.blob_log(plane, min_sigma=min_sigma, max_sigma=max_sigma, num_sigma=10, threshold=threshold)
elif method == "dog":
    found = feature.blob_dog(plane, min_sigma=min_sigma, max_sigma=max_sigma, threshold=threshold)
elif method == "doh":
    found = feature.blob_doh(plane, min_sigma=min_sigma, max_sigma=max_sigma, threshold=threshold / 10)
else:
    smooth = filters.gaussian(plane, sigma=min_sigma)
    peaks = feature.peak_local_max(smooth, min_distance=max(1, int(max_sigma)), threshold_abs=threshold)
    found = np.column_stack([peaks, np.full(len(peaks), min_sigma)]) if len(peaks) else np.zeros((0, 3))
blobs = pd.DataFrame(found[:, :3], columns=["y", "x", "sigma"])
blobs["radius"] = blobs["sigma"] * (1.0 if method == "doh" else np.sqrt(2))
blobs["intensity"] = plane[blobs["y"].astype(int), blobs["x"].astype(int)] if len(blobs) else []
`],
  ["output", `# @output name=blobs type=path pattern="blobs.csv"
# @output name=overlay type=path pattern="blobs_overlay.png"
blobs.round(3).to_csv("blobs.csv", index=False)
fig, ax = plt.subplots(figsize=(7, 7), constrained_layout=True)
ax.imshow(plane, cmap="gray")
for _, row in blobs.iterrows():
    ax.add_patch(plt.Circle((row["x"], row["y"]), row["radius"], color="tab:orange", fill=False, linewidth=1))
ax.set_title(f"{method}: {len(blobs)} blobs")
ax.axis("off")
fig.savefig("blobs_overlay.png", dpi=110)
print(f"{method} 检出 {len(blobs)} 个斑点，半径中位数 {blobs['radius'].median() if len(blobs) else 0:.1f} px")
`],
);

const ifPixelClfApoc = cells(
  ["markdown", "# APOC 像素分类\n\n用稀疏标注（1 = 背景，2 = 目标，可更多类）训练 APOC 随机森林像素分类器，在 CPU（PoCL）上预测每个像素的类别和目标类概率，并把目标类连通域计为对象。\n"],
  ["input", `# @input name=image type=path required
# @input name=annotation type=path required
# @input name=features type=str default="original gaussian_blur=2 sobel_of_gaussian_blur=2"
# @input name=object_class type=int default=2
image = "data/blobs.tif"
annotation = "data/blobs_annotations.tif"
features = "original gaussian_blur=2 sobel_of_gaussian_blur=2"
object_class = 2
`],
  ["code", `${PLOT_SETUP}${IO_SETUP}import apoc
import pyclesperanto_prototype as cle
from skimage import measure

try:
    cle.select_device("cpu")
except Exception:
    pass
print(f"OpenCL 设备：{cle.get_device().name}")
img = io.imread(image).astype(np.float32)
if img.ndim == 3:
    img = img[..., 0]
ann = io.imread(annotation).astype(np.uint32)
apoc.erase_classifier("pixel_classifier.cl")
clf = apoc.PixelClassifier(opencl_filename="pixel_classifier.cl")
clf.train(features, ann, img)
classes = np.asarray(clf.predict(image=img)).astype(np.uint8)
apoc.erase_classifier("probability_mapper.cl")
mapper = apoc.ProbabilityMapper(opencl_filename="probability_mapper.cl", output_probability_of_class=object_class)
mapper.train(features, ann, img)
probability = np.asarray(mapper.predict(image=img)).astype(np.float32)
objects = measure.label(classes == object_class)
`],
  ["output", `# @output name=segmentation type=path pattern="pixel_classes.tif"
# @output name=probability type=path pattern="probability.tif"
# @output name=model type=path pattern="pixel_classifier.cl"
# @output name=overview type=path pattern="apoc_overview.png"
io.imsave("pixel_classes.tif", classes, check_contrast=False)
io.imsave("probability.tif", probability, check_contrast=False)
fig, ax = plt.subplots(1, 3, figsize=(15, 5), constrained_layout=True)
ax[0].imshow(img, cmap="gray")
ax[0].imshow(np.ma.masked_equal(ann, 0), cmap="tab10", alpha=0.6, interpolation="nearest")
ax[0].set_title("image + annotation")
ax[1].imshow(classes, cmap="tab10", interpolation="nearest")
ax[1].set_title(f"classes ({objects.max()} objects of class {object_class})")
ax[2].imshow(probability, cmap="magma", vmin=0, vmax=1)
ax[2].set_title(f"P(class {object_class})")
for axis in ax:
    axis.axis("off")
fig.savefig("apoc_overview.png", dpi=110)
print(f"标注像素 {int((ann > 0).sum())}；各类像素 {dict(zip(*[v.tolist() for v in np.unique(classes, return_counts=True)]))}；类 {object_class} 连通对象 {int(objects.max())} 个")
`],
);

const ifTimelapse = cells(
  ["markdown", "# 时序强度分析\n\n对时序图像逐帧做顶帽背景扣除和种子分水岭分割（不做追踪），测量每帧每个对象的平均强度，并汇总成随时间变化的曲线。\n"],
  ["input", `# @input name=timelapse type=path required
# @input name=bg_radius type=int default=10
# @input name=spot_sigma type=float default=2
# @input name=outline_sigma type=float default=1
# @input name=min_area type=int default=5
timelapse = "data/timelapse.tif"
bg_radius = 10
spot_sigma = 2.0
outline_sigma = 1.0
min_area = 5
`],
  ["code", `${PLOT_SETUP}${IO_SETUP}import pandas as pd
from skimage import feature, filters, measure, morphology, segmentation

stack = io.imread(timelapse)
if stack.ndim == 2:
    stack = stack[None]
footprint = morphology.disk(bg_radius)


def segment(frame):
    flat = morphology.white_tophat(frame.astype(np.float32), footprint)
    mask = filters.gaussian(flat, sigma=outline_sigma, preserve_range=True)
    mask = mask > filters.threshold_otsu(mask)
    spots = filters.gaussian(flat, sigma=spot_sigma, preserve_range=True)
    peaks = feature.peak_local_max(spots, min_distance=1, labels=measure.label(mask))
    markers = np.zeros(frame.shape, dtype=np.int32)
    markers[tuple(peaks.T)] = np.arange(1, len(peaks) + 1)
    labels = segmentation.watershed(-spots, markers, mask=mask)
    areas = np.bincount(labels.ravel())
    labels[np.isin(labels, np.where(areas < min_area)[0])] = 0
    return segmentation.relabel_sequential(labels)[0].astype(np.int32)


label_stack = np.stack([segment(frame) for frame in stack])
per_object = pd.concat([
    pd.DataFrame(measure.regionprops_table(label_stack[t], intensity_image=stack[t], properties=("label", "area", "mean_intensity"))).assign(frame=t)
    for t in range(len(stack))
], ignore_index=True)[["frame", "label", "area", "mean_intensity"]]
summary = per_object.groupby("frame").agg(n_objects=("label", "count"), mean_intensity=("mean_intensity", "mean"), median_intensity=("mean_intensity", "median"), total_area=("area", "sum")).reindex(range(len(stack)), fill_value=0).reset_index()
summary["frame_mean_intensity"] = stack.reshape(len(stack), -1).mean(axis=1)
`],
  ["explore", `summary
`],
  ["output", `# @output name=objects type=path pattern="timelapse_intensity.csv"
# @output name=summary type=path pattern="timelapse_summary.csv"
# @output name=labels type=path pattern="timelapse_labels.tif"
# @output name=plot type=path pattern="timelapse_intensity.png"
per_object.round(3).to_csv("timelapse_intensity.csv", index=False)
summary.round(3).to_csv("timelapse_summary.csv", index=False)
io.imsave("timelapse_labels.tif", label_stack, check_contrast=False)
fig, ax = plt.subplots(1, 2, figsize=(13, 4.5), constrained_layout=True)
ax[0].plot(summary["frame"], summary["mean_intensity"], marker="o", label="object mean")
ax[0].plot(summary["frame"], summary["frame_mean_intensity"], marker=".", label="whole frame")
ax[0].set_xlabel("frame")
ax[0].set_ylabel("intensity")
ax[0].legend()
ax[0].set_title("mean intensity over time")
ax[1].bar(summary["frame"], summary["n_objects"])
ax[1].set_xlabel("frame")
ax[1].set_title("objects per frame")
fig.savefig("timelapse_intensity.png", dpi=110)
print(f"{len(stack)} 帧，{len(per_object)} 个对象测量；每帧对象数 {summary['n_objects'].tolist()}")
`],
);

const IF_SIDE_STEPS: ExampleStep[] = [
  { id: "if_morph_extra", name: "if_morph_extra", description: "免疫荧光旁支：标签形态学（开/闭、腐蚀拆分、边缘、骨架、粘连拆分）", cells: ifMorphExtra },
  { id: "if_neighbors", name: "if_neighbors", description: "免疫荧光旁支：接触邻居、距离内邻居与最近邻距离", cells: ifNeighbors },
  { id: "if_object_clf", name: "if_object_clf", description: "免疫荧光旁支：随机森林物体分类（标注或 KMeans 弱标签）", cells: ifObjectClf },
  { id: "if_coloc", name: "if_coloc", description: "免疫荧光旁支：逐细胞 Pearson / Manders 共定位与双阳性统计", cells: ifColoc },
  { id: "if_membrane_seg", name: "if_membrane_seg", description: "免疫荧光旁支：膜标记图像的局部极小种子分水岭细胞分割", cells: ifMembraneSeg },
  { id: "if_blob_detect", name: "if_blob_detect", description: "免疫荧光旁支：LoG / DoG / DoH / 局部极大斑点检测", cells: ifBlobDetect },
  { id: "if_pixel_clf_apoc", name: "if_pixel_clf_apoc", description: "免疫荧光旁支：APOC 像素分类与目标概率图（需要 apoc）", cells: ifPixelClfApoc },
  { id: "if_timelapse_intensity", name: "if_timelapse_intensity", description: "免疫荧光旁支：逐帧分割与强度随时间变化", cells: ifTimelapse },
];

export const IF_SIDE_MODULE_IDS = IF_SIDE_STEPS.map((step) => `script/${step.id}`);

/** Extra images the side branches read, copied from `public/` into the project's `data/`. */
export const IF_SIDE_FILES = [
  { path: "data/blobs.tif", asset: ["public", "examples", "if", "blobs.tif"] },
  { path: "data/blobs_annotations.tif", asset: ["public", "examples", "if", "blobs_annotations.tif"] },
  { path: "data/membrane.tif", asset: ["public", "examples", "if", "membrane.tif"] },
  { path: "data/timelapse.tif", asset: ["public", "examples", "if", "timelapse.tif"] },
] as const;

/** The side-branch notebooks, in the IF example project. */
export function ifSideNotebooks(projectId = IF_EXAMPLE_PROJECT_ID): NotebookDoc[] {
  return stepNotebooks(IF_SIDE_STEPS, projectId);
}

/**
 * The full workflow: the whole main chain (through measurement and the summary), with post-processing also fanning
 * out to morphology, neighbours, object classification and colocalisation, blob detection on the image, and
 * membrane, APOC and time-lapse branches on their own images. `example_if` stays the main chain only.
 */
export function ifSideWorkflow(projectId = IF_EXAMPLE_PROJECT_ID): WorkflowDoc {
  return {
    id: "example_if_side",
    name: "免疫荧光完整分析示例（主链 + 旁支）",
    description: "完整主链（背景扣除 → 分割 → 后处理 → 测量 → 统计聚类），后处理后扇出形态学、邻域、物体分类、共定位，原图斑点检测；并行：膜分割、APOC 像素分类、时序强度",
    version: 1,
    params: { outdir: "results_side" },
    projectId,
    nodes: [
      node("image", FILE_ID, "IMAGE", 0, 240, { config: {}, settings: { path: "data/image.tif" } }),
      node("pre", "script/if_preprocess", "IF_PREPROCESS", 380, 80, { widgets: { nuclei_channel: 0, background_sigma: 50, smooth_sigma: 2 } }),
      node("seg", "script/if_segment", "IF_SEGMENT", 780, 80, { widgets: { min_distance: 8, distance_sigma: 2 } }),
      node("post", "script/if_postprocess", "IF_POSTPROCESS", 1180, 80, { widgets: { min_area: 50, expand_distance: 8 } }),
      node("measure", "script/if_measure", "IF_MEASURE", 1600, -320, { widgets: { nuclei_channel: 0 } }),
      node("summary", "script/if_summarize", "IF_SUMMARIZE", 2000, -320, { widgets: { n_clusters: 3, nuclei_channel: 0 } }),
      node("morph", "script/if_morph_extra", "IF_MORPH_EXTRA", 1600, -120, { widgets: { op: "open", radius: 2 } }),
      node("neighbors", "script/if_neighbors", "IF_NEIGHBORS", 1600, 80, { widgets: { max_distance: 60, n_nearest: 3 } }),
      node("objclf", "script/if_object_clf", "IF_OBJECT_CLF", 1600, 280, { widgets: { annotation: "", n_classes: 3, n_trees: 100 } }),
      node("coloc", "script/if_coloc", "IF_COLOC", 1600, 480, { widgets: { channel_a: 1, channel_b: 2 } }),
      node("blob", "script/if_blob_detect", "IF_BLOB_DETECT", 380, 400, { widgets: { channel_index: 0, method: "log", min_sigma: 4, max_sigma: 12, threshold: 0.05 } }),
      node("membrane", FILE_ID, "MEMBRANE", 0, 680, { config: {}, settings: { path: "data/membrane.tif" } }),
      node("memseg", "script/if_membrane_seg", "IF_MEMBRANE_SEG", 380, 680, { widgets: { frame: 0, spot_sigma: 6, outline_sigma: 2, min_area: 30, background_factor: 1.25 } }),
      node("blobs", FILE_ID, "BLOBS", 0, 900, { config: {}, settings: { path: "data/blobs.tif" } }),
      node("blobs_ann", FILE_ID, "BLOBS_ANNOTATION", 0, 1060, { config: {}, settings: { path: "data/blobs_annotations.tif" } }),
      node("apoc", "script/if_pixel_clf_apoc", "IF_PIXEL_CLF_APOC", 380, 960, { widgets: { features: "original gaussian_blur=2 sobel_of_gaussian_blur=2", object_class: 2 } }),
      node("timelapse", FILE_ID, "TIMELAPSE", 0, 1260, { config: {}, settings: { path: "data/timelapse.tif" } }),
      node("tl", "script/if_timelapse_intensity", "IF_TIMELAPSE_INTENSITY", 380, 1260, { widgets: { bg_radius: 10, spot_sigma: 2, outline_sigma: 1, min_area: 5 } }),
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
      edge("post", "nuclei", "morph", "labels"),
      edge("post", "cells", "neighbors", "labels"),
      edge("image", "file", "objclf", "image"),
      edge("post", "nuclei", "objclf", "labels"),
      edge("image", "file", "coloc", "image"),
      edge("post", "nuclei", "coloc", "nuclei"),
      edge("post", "cells", "coloc", "cells"),
      edge("image", "file", "blob", "image"),
      edge("membrane", "file", "memseg", "membrane_image"),
      edge("blobs", "file", "apoc", "image"),
      edge("blobs_ann", "file", "apoc", "annotation"),
      edge("timelapse", "file", "tl", "timelapse"),
    ],
    updatedAt: EXAMPLE_TIME,
  };
}
