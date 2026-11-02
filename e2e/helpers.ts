import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";

/** Steps shared by the acceptance specs: notebooks published as modules, chained on the canvas, run for real. */

/**
 * Relative navigation that also works in the packaged app, whose window has no Playwright baseURL: a path is
 * resolved against the page's current origin once it has one.
 */
export function go(page: Page, path: string) {
  const current = page.url();
  return page.goto(path.startsWith("/") && current.startsWith("http") ? new URL(path, current).toString() : path);
}

export const artifactDirs = [join(process.cwd(), "e2e-artifacts"), join(process.cwd(), "test-results", "e2e-artifacts")];

export function shot(page: Page, name: string) {
  return Promise.all(artifactDirs.map((dir) => {
    mkdirSync(dir, { recursive: true });
    return page.screenshot({ path: join(dir, name) });
  }));
}

export async function fillCell(page: Page, source: string) {
  const box = page.getByRole("textbox", { name: /单元格 \d+ 源码/ }).last();
  await box.fill(source);
  await expect(box).toHaveValue(source);
}

/** Run buttons stay disabled while the notebook has unsaved edits. */
export async function waitForNotebookSaved(page: Page) {
  await expect(page.getByRole("button", { name: "运行单元格 1" })).toBeEnabled({ timeout: 20_000 });
}

/** Runs one cell in the kernel and waits for its output, or for the kernel to go idle. */
export async function runCell(page: Page, number: number, expected?: RegExp) {
  await waitForNotebookSaved(page);
  await page.getByRole("button", { name: `运行单元格 ${number}` }).click();
  if (expected) {
    // Fail with the traceback as soon as the cell errors, instead of waiting out the timeout.
    const error = page.locator('[data-output="error"]');
    await expect
      .poll(
        async () => {
          if (await error.count()) throw new Error(`单元格 ${number} 报错:\n${await error.first().innerText()}`);
          return page.getByText(expected).first().isVisible();
        },
        { timeout: 300_000, intervals: [500, 1_000, 2_000] },
      )
      .toBe(true);
  }
  else await expect(page.getByRole("status").filter({ hasText: "内核空闲" })).toBeVisible({ timeout: 180_000 });
  await expect(page.getByRole("button", { name: `运行单元格 ${number}` })).toBeEnabled({ timeout: 60_000 });
}

/** Opens the example project from the welcome page unless a project is already open; the workbench needs one. */
export async function ensureProject(page: Page) {
  await go(page, "/");
  const open = await page.evaluate(async () => ((await (await fetch("/api/projects")).json()) as { current?: string }).current);
  if (open) return;
  await page.getByRole("button", { name: /从示例开始/ }).click();
  await page.waitForURL(/\/workbench/);
}

/** Opens one item of the sidebar's 流程 group, expanding the group first when it is collapsed. */
export async function flowNav(page: Page, label: "流程编排" | "运行记录" | "产物" | "模块库") {
  const nav = page.getByRole("navigation", { name: "主导航" });
  const group = nav.getByRole("button", { name: "流程" });
  if ((await group.getAttribute("aria-expanded")) !== "true") await group.click();
  await nav.getByRole("link", { name: label }).click();
}

/** Marks the selected cell as a module input or output through the toolbar. */
export async function markCell(page: Page, role: "输入" | "输出") {
  await page.getByRole("combobox", { name: "当前单元格类型" }).click();
  await page.getByRole("option", { name: role, exact: true }).click();
}

/** 导出 › 导出为模块… */
export async function exportModule(page: Page) {
  await page.getByRole("button", { name: /^导出/ }).click();
  await page.getByRole("menuitem", { name: /导出为模块/ }).click();
}

/** Writes a notebook from cells, runs the probe cells in the kernel, and publishes it with path bindings for its file inputs. */
export async function notebookModule(page: Page, name: string, cells: { source: string; role?: "input" | "output" }[], probe: { cell: number; text?: RegExp }[], bindings: { port: string; path: string } | { port: string; path: string }[], shotPrefix = "e2e-sc") {
  await ensureProject(page);
  await go(page, "/workbench");
  await page.getByRole("button", { name: "新建笔记本", exact: true }).click();
  await page.waitForURL(/\/workbench\/nb_/);
  await page.getByRole("textbox", { name: "笔记本名称" }).fill(name);
  for (const [index, cell] of cells.entries()) {
    if (index > 0) await page.getByRole("button", { name: "+ 代码" }).click();
    await fillCell(page, cell.source);
    if (cell.role === "input") await markCell(page, "输入");
    if (cell.role === "output") await markCell(page, "输出");
  }
  // Each probe runs one cell; later cells only work because the kernel kept the earlier variables.
  await expect(page.getByRole("status").filter({ hasText: "内核未启动" })).toBeVisible();
  for (const { cell, text } of probe) await runCell(page, cell, text);
  await expect(page.getByRole("status").filter({ hasText: "内核空闲" })).toBeVisible();
  await shot(page, `${shotPrefix}-${name.split("_")[1]}-notebook.png`);

  await waitForNotebookSaved(page);
  await exportModule(page);
  await page.waitForURL(/\/publish\?step=1/);
  await page.getByRole("button", { name: "下一步：试跑" }).click();
  for (const binding of [bindings].flat()) {
    const group = page.getByRole("group", { name: binding.port, exact: true });
    await group.getByRole("radio", { name: "路径" }).click();
    await page.getByRole("textbox", { name: `${binding.port} 路径` }).fill(binding.path);
  }
  await page.getByRole("button", { name: "开始试跑" }).click();
  await expect
    .poll(async () => {
      const heading = await page.getByRole("heading", { name: /^日志/ }).innerText();
      if (heading.includes("失败")) throw new Error(`${heading}\n${await page.locator("pre").last().innerText()}`);
      return heading;
    }, { timeout: 600_000, intervals: [1_000, 2_000, 5_000] })
    .toContain("通过");
  await page.getByRole("button", { name: "下一步：保存" }).click();
  await page.getByRole("button", { name: /^保存为模块 v1/ }).click();
  await page.waitForURL("**/modules");
}

/** Drags a wire from an output handle to empty canvas on its right and picks the module the search offers. */
export async function extend(page: Page, from: Locator, port: string, module: string) {
  const handle = from.locator(`.react-flow__handle[data-handleid="out:${port}"]`);
  const box = await handle.boundingBox();
  if (!box) throw new Error(`找不到输出端口 ${port}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
  const search = page.getByRole("dialog");
  await search.getByRole("textbox").fill(module);
  await search.getByRole("button", { name: new RegExp(`^${module}`, "i") }).first().click();
  await expect(search).toBeHidden();
}

/** Drags a wire between two existing handles, e.g. a second reference into a module's other input. */
export async function connect(page: Page, from: Locator, output: string, to: Locator, input: string) {
  // Both ends must be on screen; the inspector or a far-right node can otherwise hide the target handle.
  await page.keyboard.press("Escape");
  await page.locator(".react-flow__controls-fitview").click();
  await page.waitForTimeout(400);
  const source = await from.locator(`.react-flow__handle[data-handleid="out:${output}"]`).boundingBox();
  const target = await to.locator(`.react-flow__handle[data-handleid="in:${input}"]`).boundingBox();
  if (!source || !target) throw new Error(`找不到端口 ${output} → ${input}`);
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 16 });
  await page.mouse.up();
  // Dropping beside the handle opens the module search instead of connecting; fail with that, not a later count.
  await expect(page.getByPlaceholder(/^搜索能连接/)).toHaveCount(0);
}

/** Adds a file input node from the library and points it at `path`. */
export async function addFileInput(page: Page, path: string) {
  const library = page.getByRole("complementary", { name: "模块库" });
  await expect(library).toBeVisible({ timeout: 60_000 });
  await library.getByPlaceholder("搜索模块").fill("文件输入");
  await library.getByRole("button", { name: "文件输入", exact: true }).click();
  const input = page.locator(".react-flow__node").filter({ has: page.getByText(/^FILE(_\d+)?$/) }).last();
  await input.getByRole("textbox", { name: "文件路径" }).fill(path);
  await expect(input.getByText(/^--file(_\d+)?$/)).toBeVisible();
  return input;
}

/** Starts the canvas with the Shell runtime and waits on the run page until it succeeds. */
export async function runWithShell(page: Page) {
  await page.getByRole("button", { name: "运行", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("容器 / 环境（-profile）").click();
  await page.getByRole("option", { name: /^Shell/ }).click();
  const start = dialog.getByRole("button", { name: "启动运行" });
  if (!(await start.isEnabled())) throw new Error((await dialog.locator("li").allInnerTexts()).join("\n") || "启动运行不可用");
  await start.click();
  await page.waitForURL(/\/runs\/[^/]+$/);
  await expect
    .poll(async () => {
      const text = await page.locator("section header").first().innerText();
      if (/失败|已停止/.test(text)) {
        await page.getByRole("tab", { name: "日志" }).click().catch(() => undefined);
        throw new Error(`运行没有成功：\n${text}\n${(await page.locator("body").innerText()).slice(-6000)}`);
      }
      return /成功/.test(text);
    }, { timeout: 20 * 60_000, intervals: [2_000, 5_000] })
    .toBe(true);
}
