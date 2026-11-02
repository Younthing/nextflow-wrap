import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { artifactDirs, extend, notebookModule, runWithShell, shot } from "./helpers";

/**
 * Single-cell acceptance on the real stack: two scanpy notebooks run in the persistent Jupyter
 * kernel, publish as modules after a host try-run, connect on the canvas behind a reference input,
 * and run under real Nextflow with the Shell runtime. The run must publish a UMAP and marker table.
 *
 * Data comes from scripts/make-pbmc-demo.py: PBMC3K_H5AD, else the 10x PBMC 3k download,
 * else synthetic PBMC-like counts when offline. Needs python3 with scanpy, igraph and ipykernel.
 */

const dataDir = process.env.NEXTFLOW_STUDIO_DATA_DIR ?? "/tmp/nextflow-studio-e2e";
const counts = join(dataDir, "demo", "pbmc3k.h5ad");

const QC_INPUT = (path: string) => [
  "# @input name=adata type=path required",
  "# @input name=min_genes type=int default=200",
  `adata = "${path}"`,
  "min_genes = 200",
].join("\n");

const QC_WORK = [
  "import scanpy as sc",
  "ad = sc.read_h5ad(adata)",
  "ad.var_names_make_unique()",
  'ad.var["mt"] = ad.var_names.str.upper().str.startswith("MT-")',
  'sc.pp.calculate_qc_metrics(ad, qc_vars=["mt"], inplace=True, percent_top=None, log1p=False)',
  "sc.pp.filter_cells(ad, min_genes=min_genes)",
  "sc.pp.filter_genes(ad, min_cells=3)",
  "ad = ad[ad.obs.pct_counts_mt < 20].copy()",
  'print(f"kept {ad.n_obs} cells")',
].join("\n");

const QC_OUTPUT = [
  "# @output name=filtered type=path pattern=filtered.h5ad",
  "# @output name=qc_plot type=path pattern=qc.png",
  "import matplotlib.pyplot as plt",
  "fig, axis = plt.subplots(figsize=(4, 3))",
  "axis.hist(ad.obs.n_genes_by_counts, bins=40)",
  'axis.set_xlabel("genes per cell")',
  'fig.savefig("qc.png", dpi=80)',
  'ad.write_h5ad("filtered.h5ad")',
].join("\n");

const CLUSTER_INPUT = (path: string) => [
  "# @input name=filtered type=path required",
  `filtered = "${path}"`,
].join("\n");

const CLUSTER_OUTPUT = [
  "# @output name=umap type=path pattern=umap.png",
  "# @output name=markers type=path pattern=markers.csv",
  "import pandas as pd",
  "import scanpy as sc",
  "ad = sc.read_h5ad(filtered)",
  "sc.pp.filter_cells(ad, min_genes=1)",
  "sc.pp.normalize_total(ad, target_sum=1e4)",
  "sc.pp.log1p(ad)",
  "sc.pp.highly_variable_genes(ad, n_top_genes=min(2000, ad.n_vars - 1))",
  "ad = ad[:, ad.var.highly_variable].copy()",
  "sc.pp.scale(ad, max_value=10)",
  "sc.tl.pca(ad, n_comps=20)",
  "sc.pp.neighbors(ad, n_neighbors=10)",
  "sc.tl.umap(ad, random_state=0)",
  'sc.tl.leiden(ad, resolution=0.5, random_state=0, flavor="igraph", n_iterations=2, directed=False)',
  'sc.tl.rank_genes_groups(ad, "leiden", method="t-test")',
  'sc.pl.umap(ad, color="leiden", return_fig=True).savefig("umap.png", dpi=80)',
  'pd.DataFrame(ad.uns["rank_genes_groups"]["names"]).head(10).to_csv("markers.csv", index=False)',
  'print("clusters", ad.obs["leiden"].nunique())',
].join("\n");

test.describe("single-cell user path", () => {
  test("scanpy notebooks to a clustered UMAP", async ({ page }) => {
    test.setTimeout(30 * 60_000);
    const source = execFileSync("python3", ["scripts/make-pbmc-demo.py", counts], { encoding: "utf8" }).trim();
    const stamp = Date.now().toString(36);
    const qcName = `scanpy_qc_${stamp}`;
    const clusterName = `scanpy_cluster_${stamp}`;

    await page.goto("/workflows");
    await expect(page.getByText(/Nextflow \d/)).not.toContainText("模拟", { timeout: 60_000 });

    await notebookModule(page, qcName, [
      { source: QC_INPUT(counts), role: "input" },
      { source: QC_WORK },
      { source: QC_OUTPUT, role: "output" },
    ], [{ cell: 1 }, { cell: 2, text: /kept \d+ cells/ }], { port: "adata", path: counts });

    await notebookModule(page, clusterName, [
      { source: CLUSTER_INPUT(counts), role: "input" },
      { source: CLUSTER_OUTPUT, role: "output" },
    ], [{ cell: 1 }, { cell: 2, text: /clusters \d+/ }], { port: "filtered", path: counts });

    await page.goto("/workflows");
    await page.getByRole("button", { name: "新建", exact: true }).click();
    await page.waitForURL(/\/workflows\/(?!modules$)[^/]+$/);
    await page.getByRole("textbox", { name: "流程名称" }).fill(`单细胞 ${stamp}`);
    const library = page.getByRole("complementary", { name: "模块库" });
    await expect(library).toBeVisible({ timeout: 60_000 });
    await library.getByPlaceholder("搜索模块").fill("参考文件");
    await library.getByRole("button", { name: "参考文件", exact: true }).click();
    const reference = page.locator(".react-flow__node").filter({ hasText: "REFERENCE" });
    await reference.evaluate((el) => (el as HTMLElement).click());
    await page.locator("#ref-param").fill("counts");
    await page.locator("#ref-value").fill(counts);

    // Zoom out and move the reference to the left so the chain fits beside it, clear of the minimap.
    await page.getByRole("button", { name: /zoom out/i }).click();
    await page.getByRole("button", { name: /zoom out/i }).click();
    const pane = await page.locator(".react-flow__pane").boundingBox();
    const header = await reference.boundingBox();
    if (!pane || !header) throw new Error("画布没有渲染");
    await page.mouse.move(header.x + 30, header.y + 12);
    await page.mouse.down();
    await page.mouse.move(pane.x + 60, pane.y + pane.height / 3, { steps: 12 });
    await page.mouse.up();
    const qcAlias = qcName.toUpperCase();
    await extend(page, reference, "file", qcName);
    const qc = page.locator(".react-flow__node").filter({ hasText: qcAlias });
    await expect(qc).toBeVisible();
    await extend(page, qc, "filtered", clusterName);
    const clusterAlias = clusterName.toUpperCase();
    await expect(page.locator(".react-flow__node").filter({ hasText: clusterAlias })).toBeVisible();
    await expect(page.locator(".react-flow__edge")).toHaveCount(2);
    await expect(page.getByText("已保存", { exact: true })).toBeVisible({ timeout: 20_000 });
    await shot(page, "e2e-sc-canvas.png");

    await runWithShell(page);

    await page.getByRole("tab", { name: "结果" }).click();
    const published = page.locator("li").filter({ has: page.getByRole("button", { name: new RegExp(`^${clusterAlias.toLowerCase()}/`) }) });
    await published.getByRole("button", { name: /^umap\.png/ }).click();
    await expect(page.getByRole("tabpanel", { name: "结果" }).locator('img[data-output="image"]')).toBeVisible({ timeout: 30_000 });
    await shot(page, "e2e-sc-umap.png");
    await published.getByRole("button", { name: /^markers\.csv/ }).click();
    await expect(page.getByRole("tabpanel", { name: "结果" }).getByRole("table")).toBeVisible();
    await shot(page, "e2e-sc-markers.png");

    for (const dir of artifactDirs) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "e2e-sc-notes.md"), [
        "# single-cell user path",
        "",
        `- data: ${source}`,
        `- modules: ${qcName}, ${clusterName}`,
        `- run: ${page.url()}`,
        "- notebook cells ran in the persistent Jupyter kernel; try-run and run used the host python3",
        "",
      ].join("\n"));
    }
  });
});
