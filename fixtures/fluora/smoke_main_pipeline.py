"""Smoke test of the MAIN fluorescence / cell-quantification chain
(BioImageAnalysisNotebooks): load multi-channel IF -> filter/background ->
segment -> post-process -> features -> table -> stats/plots/clustering.

Data: data/BBBC022/IXMtest_A02_s9.tif  (U2OS Cell-Painting crop, 3 channels,
      ch0 = Hoechst nuclei, ch1/ch2 = other stains), Broad BBBC022.
Run:  conda activate bia-main && python smoke_main_pipeline.py [--no-gpu]
      --no-gpu skips pyclesperanto (OpenCL) and uses skimage otsu+watershed.
"""
import sys, time
from pathlib import Path
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from skimage import io, filters, morphology, measure, segmentation, feature, exposure
from scipy import ndimage as ndi
from sklearn.preprocessing import StandardScaler
from sklearn.cluster import KMeans

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
OUT = ROOT / "smoke_out"
OUT.mkdir(exist_ok=True)
t0 = time.time()

# 1. load / multi-channel --------------------------------------------------
img = io.imread(DATA / "BBBC022" / "IXMtest_A02_s9.tif")   # (Y, X, C)
print(f"[load] image shape={img.shape} dtype={img.dtype}")
chans = {"nuclei": img[..., 0], "ch1": img[..., 1], "ch2": img[..., 2]}
for k in chans:
    print(f"[load] {k}: shape={chans[k].shape} dtype={chans[k].dtype} "
          f"min={chans[k].min()} max={chans[k].max()}")
nuc = chans["nuclei"].astype(np.float32)

# 2. filter / background removal -----------------------------------------
nuc_bg = np.clip(nuc - filters.gaussian(nuc, sigma=50, preserve_range=True), 0, None)  # subtract smooth background
nuc_f = filters.gaussian(nuc_bg, sigma=2, preserve_range=True)  # denoise

# 3. segmentation ----------------------------------------------------------
backend = "skimage"
labels = None
if "--no-gpu" not in sys.argv:
    try:
        import pyclesperanto_prototype as cle
        dev = None
        for name in ("NVIDIA", "cpu"):   # PoCL-CUDA can't build kernels for new GPUs -> PoCL CPU
            try:
                cle.select_device(name)
                labels = np.asarray(cle.voronoi_otsu_labeling(nuc_bg, spot_sigma=3, outline_sigma=1)).astype(np.int32)
                dev = cle.get_device(); break
            except Exception as e:
                print(f"[seg] OpenCL device '{name}' failed: {type(e).__name__}")
        if dev is None: raise RuntimeError("no working OpenCL device")
        backend = f"pyclesperanto voronoi_otsu_labeling on {dev.name}"
    except Exception as e:  # OpenCL problem -> classical CPU fallback
        print(f"[seg] pyclesperanto failed ({e!r}); falling back to skimage")
if labels is None:
    mask = nuc_f > filters.threshold_otsu(nuc_f)
    dist = ndi.distance_transform_edt(mask)
    peaks = feature.peak_local_max(filters.gaussian(dist, 2), min_distance=8, labels=measure.label(mask))
    markers = np.zeros_like(mask, dtype=np.int32)
    markers[tuple(peaks.T)] = np.arange(1, len(peaks) + 1)
    labels = segmentation.watershed(-dist, markers, mask=mask).astype(np.int32)
    backend = "skimage otsu + distance watershed"
print(f"[seg] backend: {backend}; raw objects: {labels.max()}")

# 4. post-processing -------------------------------------------------------
labels = segmentation.clear_border(labels)
areas = np.bincount(labels.ravel()); small = np.where(areas < 50)[0]
labels[np.isin(labels, small)] = 0                                 # drop debris < 50 px
labels, _, _ = segmentation.relabel_sequential(labels)
cells = segmentation.expand_labels(labels, distance=8)       # approx. cell body for cytoplasm channels
print(f"[post] nuclei after border/size filter: {labels.max()}")

# 5. feature extraction ----------------------------------------------------
props = ("label", "area", "perimeter", "eccentricity", "solidity",
         "major_axis_length", "minor_axis_length", "centroid", "mean_intensity", "max_intensity")
df = pd.DataFrame(measure.regionprops_table(labels, intensity_image=chans["nuclei"], properties=props))
df = df.rename(columns={"mean_intensity": "nuclei_mean", "max_intensity": "nuclei_max"})
for ch in ("ch1", "ch2"):
    t = pd.DataFrame(measure.regionprops_table(cells, intensity_image=chans[ch],
                                               properties=("label", "mean_intensity", "area")))
    df = df.merge(t.rename(columns={"mean_intensity": f"{ch}_cell_mean", "area": "cell_area"}),
                  on="label", how="left", suffixes=("", "_dup"))
df = df.loc[:, ~df.columns.str.endswith("_dup")]
df["circularity"] = 4 * np.pi * df["area"] / df["perimeter"].clip(lower=1) ** 2

# 6. table + clustering ----------------------------------------------------
feat_cols = ["area", "eccentricity", "solidity", "circularity", "nuclei_mean", "ch1_cell_mean", "ch2_cell_mean"]
k = 3 if len(df) >= 6 else 1
df["cluster"] = KMeans(n_clusters=k, n_init=10, random_state=0).fit_predict(
    StandardScaler().fit_transform(df[feat_cols])) if len(df) else []
csv = OUT / "bbbc022_per_nucleus_features.csv"
df.to_csv(csv, index=False)
desc = df[feat_cols].describe().T
desc_csv = OUT / "bbbc022_descriptive_stats.csv"
desc.to_csv(desc_csv)

# 7. plots -----------------------------------------------------------------
fig, ax = plt.subplots(2, 3, figsize=(15, 9))
rgb = np.dstack([exposure.rescale_intensity(chans[c].astype(float), out_range=(0, 1)) for c in ("ch2", "ch1", "nuclei")])
ax[0, 0].imshow(rgb); ax[0, 0].set_title("composite (R ch2 / G ch1 / B Hoechst)")
ax[0, 1].imshow(nuc_f, cmap="gray"); ax[0, 1].set_title("nuclei: bg-subtracted + gaussian")
ax[0, 2].imshow(segmentation.mark_boundaries(rgb, cells, color=(1, 1, 0)))
ax[0, 2].imshow(np.ma.masked_equal(labels, 0), cmap="nipy_spectral", alpha=0.45)
ax[0, 2].set_title(f"{labels.max()} nuclei + expanded cell outlines")
ax[1, 0].hist(df["area"], bins=25); ax[1, 0].set_title("nucleus area (px)")
sc = ax[1, 1].scatter(df["nuclei_mean"], df["ch1_cell_mean"], c=df["cluster"], cmap="tab10")
ax[1, 1].set_xlabel("Hoechst mean"); ax[1, 1].set_ylabel("ch1 mean (cell)"); ax[1, 1].set_title("KMeans clusters")
df.boxplot(column=["nuclei_mean", "ch1_cell_mean", "ch2_cell_mean"], ax=ax[1, 2]); ax[1, 2].set_title("channel intensities")
for a in ax[0]: a.axis("off")
plt.tight_layout()
png = OUT / "bbbc022_main_pipeline.png"
fig.savefig(png, dpi=120)
lab_tif = OUT / "bbbc022_nuclei_labels.tif"
io.imsave(lab_tif, labels.astype(np.uint16), check_contrast=False)

print("\n=== SUMMARY ===")
print(f"objects (nuclei): {len(df)}   clusters: {k}")
print(desc[["mean", "std", "min", "max"]].round(2).to_string())
print(f"cluster sizes: {df['cluster'].value_counts().sort_index().to_dict()}")
for p in (csv, desc_csv, png, lab_tif):
    print(f"wrote {p}")
print(f"elapsed {time.time() - t0:.1f}s")
