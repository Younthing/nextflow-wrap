import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Real user path, once for Python and once for R:
 * new notebook → plot → mark I/O → publish with a hand-filled conda yaml and
 * container → try-run → canvas → real Nextflow → results show the figure and
 * table → source-changed hint → publish v2 → resume hits the cache.
 *
 * Try-run uses the hand-filled conda yaml and container, the same fields saved on the module.
 * This job has no container daemon. TRY_RUN_CONTAINER_BIN is a docker-compatible shim that
 * executes the task command, and the try-run log names that image plus the conda path.
 * The launch uses the Shell engine (still Nextflow's local executor). Shell does not pull
 * the image; the process file keeps both directives and runs python3 / Rscript on the host.
 * R cells stay edit-only in the notebook; Rscript runs them at try-run and in Nextflow.
 */

const dataDir = process.env.NEXTFLOW_STUDIO_DATA_DIR ?? "/tmp/nextflow-studio-e2e";
const samplesheet = join(dataDir, "demo", "samplesheet.csv");
const artifactDirs = ["/opt/cursor/artifacts", "e2e-artifacts"].filter((dir, index, all) => {
  if (dir.startsWith("/opt/cursor") && !existsSync("/opt/cursor")) return false;
  return all.indexOf(dir) === index;
});

const PYTHON_PLOT = `
class Plot:
    def _repr_svg_(self):
        return '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="32"><rect width="80" height="32" fill="#2563eb"/><text x="6" y="21" fill="white">py</text></svg>'
    def __repr__(self):
        return "散点图"
Plot()
`.trim();

const R_PLOT = `
svg("figure.svg", width = 3, height = 2)
plot(c(1, 2, 3), main = "r-figure")
dev.off()
`.trim();

const INPUT_CELL = '# @input name=title type=str default="S1"';

function outputCell(language: "python" | "r"): string {
  if (language === "python") {
    return [
      "# @output name=report type=path pattern=report.html",
      "# @output name=table type=path pattern=table.csv",
      "report = (",
      "    '<!doctype html><meta charset=\"utf-8\">'",
      "    '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"120\" height=\"36\" role=\"img\" aria-label=\"py-figure\">'",
      "    '<rect width=\"120\" height=\"36\" fill=\"#2563eb\"/>'",
      "    '<text x=\"8\" y=\"24\" fill=\"white\">py-figure</text></svg>'",
      "    '<table><caption>py-table</caption><tr><th>sample</th><th>n</th></tr><tr><td>'",
      "    + title",
      "    + '</td><td>3</td></tr></table>'",
      ")",
      'open("report.html", "w", encoding="utf-8").write(report)',
      'open("table.csv", "w", encoding="utf-8").write("sample,n\\n" + title + ",3\\n")',
    ].join("\n");
  }
  return [
    "# @output name=report type=path pattern=report.html",
    "# @output name=table type=path pattern=table.csv",
    "html <- paste0(",
    "  '<!doctype html><meta charset=\"utf-8\">',",
    "  '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"120\" height=\"36\" role=\"img\" aria-label=\"r-figure\">',",
    "  '<rect width=\"120\" height=\"36\" fill=\"#16a34a\"/>',",
    "  '<text x=\"8\" y=\"24\" fill=\"white\">r-figure</text></svg>',",
    "  '<table><caption>r-table</caption><tr><th>sample</th><th>n</th></tr><tr><td>',",
    "  title,",
    "  '</td><td>4</td></tr></table>'",
    ")",
    'writeLines(html, "report.html")',
    'writeLines(paste0("sample,n\\n", title, ",4"), "table.csv")',
  ].join("\n");
}

function writeEnvFiles() {
  const envDir = join(dataDir, "envs");
  mkdirSync(envDir, { recursive: true });
  writeFileSync(
    join(envDir, "py311-pandas.yml"),
    "name: py311-pandas\nchannels:\n  - conda-forge\ndependencies:\n  - python=3.11\n",
  );
  writeFileSync(
    join(envDir, "r-deseq2.yml"),
    "name: r-deseq2\nchannels:\n  - conda-forge\n  - bioconda\ndependencies:\n  - r-base=4.3\n",
  );
}

function shot(page: Page, name: string) {
  return Promise.all(
    artifactDirs.map((dir) => {
      mkdirSync(dir, { recursive: true });
      return page.screenshot({ path: join(dir, name) });
    }),
  );
}

function note(name: string, text: string) {
  for (const dir of artifactDirs) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), text);
  }
}

async function waitForNotebookSaved(page: Page) {
  const run = page.getByRole("button", { name: "运行单元格 1" });
  await expect(run).toBeDisabled();
  await expect(run).toBeEnabled({ timeout: 20_000 });
}

async function fillCell(page: Page, source: string) {
  const box = page.getByRole("textbox", { name: /单元格 \d+ 源码/ }).last();
  await box.fill(source);
  await expect(box).toHaveValue(source);
  return box;
}

async function waitForWorkflowSaved(page: Page) {
  await expect(page.getByText(/未保存|保存中/)).toBeVisible();
  await expect(page.getByText("已保存", { exact: true })).toBeVisible({ timeout: 20_000 });
}

async function openLocalProcess(dialog: Locator) {
  await dialog.getByRole("tab", { name: /项目文件/ }).click();
  const buttons = dialog.getByRole("list", { name: "项目文件" }).getByRole("button", { name: "main.nf" });
  await expect(buttons.first()).toBeVisible();
  const count = await buttons.count();
  for (let index = 0; index < count; index += 1) {
    await buttons.nth(index).click();
    const path = dialog.locator("div.font-mono").filter({ hasText: /modules\/local\/.+\/main\.nf/ });
    if (await path.count()) {
      await expect(path.first()).toBeVisible();
      return;
    }
  }
  throw new Error("生成的项目里没有 modules/local 下的 process");
}

async function waitForSuccess(page: Page) {
  const header = page.locator("section header").first();
  await expect
    .poll(
      async () => {
        const text = await header.innerText().catch(() => "");
        if (/失败|已中断|已停止/.test(text)) {
          await page.getByRole("tab", { name: "日志" }).click().catch(() => undefined);
          const log = await page.locator("body").innerText();
          throw new Error(`运行没有成功：\n${text}\n${log.slice(-6000)}`);
        }
        return /成功/.test(text);
      },
      { timeout: 15 * 60_000, intervals: [1_000, 2_000, 3_000] },
    )
    .toBe(true);
}

/** The try-run panel, not a notebook cell `<pre>` left elsewhere in the document. */
function tryRunLog(page: Page) {
  return page.locator("section").filter({ has: page.getByRole("heading", { name: /^日志/ }) }).locator("pre");
}

async function publish(page: Page, version: "v1" | "v2", condaYaml: string, image: string, shotName: string) {
  await page.getByRole("button", { name: "发布为模块…" }).click();
  await page.waitForURL(/\/publish\?step=1/);
  await expect(page.getByRole("button", { name: "下一步：试跑" })).toBeEnabled();
  await page.getByRole("button", { name: "下一步：试跑" }).click();
  await expect(page.locator("#arg-title")).toHaveValue("S1");
  await page.locator("#publish-env-conda").fill(condaYaml);
  await page.locator("#publish-env-container").fill(image);
  await page.getByRole("button", { name: "开始试跑" }).click();
  const tryLog = tryRunLog(page);
  await expect
    .poll(
      async () => {
        const alert = page.locator("section").filter({ has: page.getByRole("heading", { name: "试跑参数" }) }).getByRole("alert");
        if (await alert.count()) throw new Error(await alert.first().innerText());
        const heading = await page.getByRole("heading", { name: /^日志/ }).innerText();
        if (heading.includes("失败")) throw new Error(`${heading}\n${await tryLog.innerText()}`);
        return heading;
      },
      { timeout: 60_000, intervals: [500, 1_000, 2_000] },
    )
    .toContain("通过");
  await expect(tryLog).toContainText(`conda '${condaYaml}'`);
  await expect(tryLog).toContainText("输入 title · 路径 · S1");
  await expect(tryLog).toContainText(`选用 container '${image}'`);
  await expect(tryLog).toContainText(`e2e docker shim: image ${image}`);
  await expect(tryLog).not.toContainText("选用本机");
  await expect(page.getByRole("cell", { name: "符合" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "下一步：保存" })).toBeEnabled();
  await page.getByRole("button", { name: "下一步：保存" }).click();
  await expect(page.locator("#publish-env-conda")).toHaveValue(condaYaml);
  await expect(page.locator("#publish-env-container")).toHaveValue(image);
  await expect(page.locator("#module-version")).toHaveValue(new RegExp(`^${version}`));
  const condaLine = `conda '${condaYaml}'`;
  await expect(page.getByText(condaLine).first()).toBeVisible();
  await expect(page.getByText(`container '${image}'`).first()).toBeVisible();
  if (version === "v2") await page.locator("#module-changelog").fill("第二次发布，画布上的 v1 复跑应命中缓存");
  await shot(page, shotName);
  await page.getByRole("button", { name: `保存为模块 ${version}` }).click();
  await page.waitForURL("**/workflows/modules");
}

async function runLanguage(page: Page, language: "python" | "r") {
  writeEnvFiles();
  expect(existsSync(samplesheet), `runner 应先写好样本表 ${samplesheet}`).toBe(true);
  const moduleName = `${language === "python" ? "py" : "r"}_e2e_${Date.now().toString(36)}`;
  const alias = moduleName.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
  const condaYaml = join(dataDir, "envs", language === "python" ? "py311-pandas.yml" : "r-deseq2.yml");
  const image = language === "python" ? "python:3.11-slim" : "r-base:4.3.3";
  const figure = language === "python" ? "py-figure" : "r-figure";
  const table = language === "python" ? "py-table" : "r-table";
  const count = language === "python" ? "3" : "4";

  await page.goto("/workflows");
  const nav = page.getByRole("navigation", { name: "主导航" });
  await expect(nav.getByRole("link", { name: "流程" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "笔记本" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "运行" })).toBeVisible();
  await expect(page.getByText(/Nextflow \d/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Nextflow \d/)).not.toContainText("模拟");

  await nav.getByRole("link", { name: "笔记本" }).click();
  await page.getByRole("button", { name: "新建笔记本" }).click();
  await page.waitForURL(/\/notebooks\/nb_/);
  const notebookUrl = page.url().split("?")[0];
  await page.getByRole("textbox", { name: "笔记本名称" }).fill(moduleName);
  await page.getByRole("textbox", { name: "笔记本说明" }).fill(
    language === "python" ? "Python 出图并发布" : "R 出图并发布",
  );
  if (language === "r") {
    await page.getByRole("button", { name: /^内核/ }).click();
    await page.getByRole("option", { name: "R 4.3 · r-deseq2" }).click();
  }
  await fillCell(page, language === "python" ? PYTHON_PLOT : R_PLOT);
  await waitForNotebookSaved(page);
  await page.getByRole("button", { name: "运行单元格 1" }).click();
  if (language === "python") {
    await expect(page.locator('img[data-output="image"]')).toBeVisible({ timeout: 30_000 });
  } else {
    await expect(page.getByText(/Rscript/)).toBeVisible({ timeout: 30_000 });
  }
  await shot(page, `e2e-${language}-plot.png`);
  await page.getByLabel("单元格 1 类型").click();
  await page.getByRole("option", { name: "自由探索" }).click();

  await page.getByRole("button", { name: "+ 代码" }).click();
  await fillCell(page, INPUT_CELL);
  await page.getByRole("button", { name: "标为输入" }).click();
  await page.getByRole("button", { name: "+ 代码" }).click();
  await fillCell(page, outputCell(language));
  await page.getByRole("button", { name: "标为输出" }).click();
  await expect(page.getByText(/入 · title/)).toBeVisible();
  await expect(page.getByText("出 · report · report.html")).toBeVisible();
  await expect(page.getByText("出 · table · table.csv")).toBeVisible();
  await shot(page, `e2e-${language}-io.png`);

  await publish(page, "v1", condaYaml, image, `e2e-${language}-publish-v1.png`);

  await nav.getByRole("link", { name: "流程" }).click();
  await page.waitForURL(/\/workflows$/);
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await page.waitForURL(/\/workflows\/(?!modules$)[^/]+$/);
  const workflowUrl = page.url().split("?")[0];
  await page.getByRole("textbox", { name: "流程名称" }).fill(moduleName);
  const library = page.getByRole("complementary", { name: "模块库" });
  await expect(library).toBeVisible({ timeout: 60_000 });
  await library.getByPlaceholder("搜索模块").fill("样本表");
  await library.getByRole("button", { name: "样本表", exact: true }).click();
  await library.getByPlaceholder("搜索模块").fill(moduleName);
  await library.getByRole("button", { name: new RegExp(`^${moduleName}`) }).click();

  const samplesheetNode = page.locator(".react-flow__node").filter({ hasText: "SAMPLESHEET" });
  await samplesheetNode.evaluate((el) => (el as HTMLElement).click());
  await page.locator("#samplesheet-path").fill(samplesheet);
  const scriptNode = page.locator(".react-flow__node").filter({ hasText: alias });
  await scriptNode.evaluate((el) => (el as HTMLElement).click());
  await scriptNode.getByRole("textbox").fill("S1", { force: true });
  await waitForWorkflowSaved(page);

  await page.getByRole("button", { name: "运行", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("容器 / 环境（-profile）").click();
  await page.getByRole("option", { name: /^Shell/ }).click();
  await expect(dialog.getByText("不使用 -profile，进程在本机 shell 里直接执行")).toBeVisible();
  await openLocalProcess(dialog);
  const processFile = dialog.getByRole("tabpanel", { name: /项目文件/ }).locator("pre");
  await expect(processFile).toContainText(`conda '${condaYaml}'`);
  await expect(processFile).toContainText(`container '${image}'`);
  await shot(page, `e2e-${language}-process.png`);
  const start = dialog.getByRole("button", { name: "启动运行" });
  if (!(await start.isEnabled())) {
    throw new Error((await dialog.locator("li").allInnerTexts()).join("\n") || "启动运行不可用");
  }
  await start.click();
  await page.waitForURL(/\/runs\/[^/]+$/);
  const runUrl = page.url().split("?")[0];
  await waitForSuccess(page);
  await page.getByRole("tab", { name: "结果" }).click();
  const published = page.locator("li").filter({
    has: page.getByRole("button", { name: new RegExp(`^${alias.toLowerCase()}/`) }),
  });
  await published.getByRole("button", { name: /^report\.html/ }).click();
  const frame = page.frameLocator(`iframe[title$="${alias.toLowerCase()}/report.html"]`);
  await expect(frame.getByRole("img", { name: figure })).toBeVisible({ timeout: 30_000 });
  await expect(frame.getByText(table)).toBeVisible();
  await shot(page, `e2e-${language}-figure.png`);
  await published.getByRole("button", { name: /^table\.csv/ }).click();
  const csv = page.getByRole("tabpanel", { name: "结果" }).getByRole("table");
  await expect(csv.getByRole("cell", { name: "S1", exact: true })).toBeVisible();
  await expect(csv.getByRole("cell", { name: count, exact: true })).toBeVisible();
  await shot(page, `e2e-${language}-results.png`);

  await page.goto(notebookUrl);
  await page.getByRole("button", { name: "+ 说明" }).click();
  const noteSource = "源修订：这一段说明不进命令行，但会让已发布的 v1 显示源已改动。";
  await page.getByRole("textbox", { name: /单元格 \d+ 源码/ }).last().fill(noteSource);
  await expect(page.getByText(noteSource)).toBeVisible();
  await waitForNotebookSaved(page);
  await page.goto(workflowUrl);
  await page.locator(".react-flow__node").filter({ hasText: alias }).evaluate((el) => (el as HTMLElement).click());
  await expect(page.getByText(/源已改动：跟钉住的原版/)).toBeVisible();
  await shot(page, `e2e-${language}-drift.png`);
  await page.getByRole("link", { name: /打开最新/ }).click();
  await page.waitForURL(new RegExp(`/notebooks/`));
  await publish(page, "v2", condaYaml, image, `e2e-${language}-publish-v2.png`);

  await page.goto(runUrl);
  await expect(page.getByRole("button", { name: "从此运行恢复" })).toBeVisible();
  await page.getByRole("button", { name: "从此运行恢复" }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/runs/") && url.href !== runUrl);
  await waitForSuccess(page);
  await page.getByRole("tab", { name: /任务/ }).click();
  const cached = page.getByRole("row").filter({ hasText: alias }).filter({ hasText: "缓存" });
  await expect(cached.first()).toBeVisible();
  await shot(page, `e2e-${language}-cache.png`);
  note(
    `e2e-${language}-notes.md`,
    [
      `# ${language} user path`,
      "",
      `- notebook: ${notebookUrl}`,
      `- workflow: ${workflowUrl}`,
      `- first run: ${runUrl}`,
      `- resume: ${page.url()}`,
      `- module: ${moduleName} (${alias})`,
      `- conda: ${condaYaml}`,
      `- container: ${image}`,
      "- try-run: container image via TRY_RUN_CONTAINER_BIN; log names that image and the conda yaml",
      "- engine: Shell (real Nextflow local executor; conda and container directives are in the process)",
      `- results: report.html shows ${figure} and ${table}; table.csv renders S1 and ${count}`,
      "- v2 is published after the source-changed hint; the canvas stays on v1, and resume reports 缓存",
      "",
    ].join("\n"),
  );
}

test.describe("real Nextflow user path", () => {
  test("python notebook to cached re-run", async ({ page }) => {
    await runLanguage(page, "python");
  });

  test("R notebook to cached re-run", async ({ page }) => {
    await runLanguage(page, "r");
  });
});
