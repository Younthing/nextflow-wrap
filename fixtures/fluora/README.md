# Fluora / immunofluorescence example

- `public/examples/if/IXMtest_A02_s9.tif` — the image seeded as `data/image.tif` in the 免疫荧光分析示例 project.
  A crop of BBBC022 (U2OS Cell Painting, Gustafsdottir et al. 2013), Broad Bioimage Benchmark Collection,
  https://bbbc.broadinstitute.org/BBBC022 (CC0). Shape Y×X×C, uint16; channel 0 is Hoechst (nuclei).
  It lives under `public/` because that folder ships with the desktop app's server.
- `smoke_main_pipeline.py` — the reference script the example notebooks follow (`--no-gpu` path):
  background removal → otsu + distance watershed → clear border / size filter / expand → regionprops → KMeans.

Python packages: numpy<2, scipy, pandas, scikit-image (tifffile), matplotlib, scikit-learn.
