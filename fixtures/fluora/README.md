# Fluora / immunofluorescence example

- `public/examples/if/IXMtest_A02_s9.tif` — the image seeded as `data/image.tif` in the 免疫荧光分析示例 project.
  A crop of BBBC022 (U2OS Cell Painting, Gustafsdottir et al. 2013), Broad Bioimage Benchmark Collection,
  https://bbbc.broadinstitute.org/BBBC022 (CC0). Shape Y×X×C, uint16; channel 0 is Hoechst (nuclei).
  It lives under `public/` because that folder ships with the desktop app's server.
- `smoke_main_pipeline.py` — the reference script the example notebooks follow (`--no-gpu` path):
  background removal → otsu + distance watershed → clear border / size filter / expand → regionprops → KMeans.

Python packages: numpy<2, scipy, pandas, scikit-image (tifffile), matplotlib, scikit-learn.

## Side branches (`example_if_side`)

Eight more notebooks/modules in `src/features/notebook/examples-if-side.ts`. `example_if` stays the five-module main
chain; `example_if_side` is the full workflow: the whole main chain plus every side branch:

- After `if_postprocess` (main-chain labels on `data/image.tif`): `if_morph_extra` (open / close / erode_connected /
  edges / skeleton / split_touching), `if_neighbors` (touching + proximal neighbours, nearest distances),
  `if_object_clf` (random forest; annotation image or KMeans weak labels), `if_coloc` (per-cell Pearson / Manders,
  double positives), and `if_blob_detect` on the image (LoG / DoG / DoH / local maxima).
- Own images: `if_membrane_seg` (`data/membrane.tif`), `if_pixel_clf_apoc` (`data/blobs.tif` +
  `data/blobs_annotations.tif`; the only module that needs `apoc`, OpenCL on the CPU through PoCL),
  `if_timelapse_intensity` (`data/timelapse.tif`).

Images and their sources: `public/examples/if/SOURCES.md`. No napari, no GPU, no deep learning.
