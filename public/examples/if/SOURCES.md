# Example images (免疫荧光分析示例)

Seeded into the project's `data/` folder. All come from the `data/` folder of
BioImageAnalysisNotebooks (Robert Haase et al., https://github.com/haesleinhuepf/BioImageAnalysisNotebooks, BSD-3).

| File here | Project path | Source |
|---|---|---|
| `IXMtest_A02_s9.tif` | `data/image.tif` | BBBC022 crop (U2OS Cell Painting, Gustafsdottir et al. 2013), Broad Bioimage Benchmark Collection, https://bbbc.broadinstitute.org/BBBC022 (CC0). Y×X×C uint16, channel 0 = Hoechst. |
| `blobs.tif` | `data/blobs.tif` | ImageJ "blobs" sample image (254×256 uint8), as shipped with BioImageAnalysisNotebooks. |
| `blobs_annotations.tif` | `data/blobs_annotations.tif` | Sparse pixel annotation for `blobs.tif` from BioImageAnalysisNotebooks (1 = background, 2 = blob). |
| `membrane.tif` | `data/membrane.tif` | Frame 2 of `membrane_2d_timelapse.tif` (256×256 uint16), courtesy of Sascha M. Kuhn, Nadler Lab, MPI-CBG Dresden. |
| `timelapse.tif` | `data/timelapse.tif` | `CalibZAPWfixed_000154_max.tif[::10, :200, :200]` (10×200×200 uint8), the time-lapse used in the notebook chapter "Measuring features in a time-lapse dataset" (https://zenodo.org/record/5206107). |
