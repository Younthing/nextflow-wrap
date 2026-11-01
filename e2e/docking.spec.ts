import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { addReference, artifactDirs, connect, extend, notebookModule, runWithShell, shot } from "./helpers";

/**
 * Docking acceptance on the real stack, the second built-in example: an RDKit notebook turns SMILES into 3D
 * ligands, a Vina notebook docks them on the CPU, both publish as modules after a host try-run, connect on the
 * canvas behind two reference inputs (ligand table and receptor), and run under real Nextflow with the Shell
 * runtime. The run must publish a score table and a best pose that opens in the Mol* view.
 *
 * Inputs come from scripts/make-docking-demo.py: DOCKING_RECEPTOR_PDBQT, else a synthetic pocket.
 * Needs python3 with vina, meeko, rdkit and ipykernel.
 */

const dataDir = process.env.NEXTFLOW_STUDIO_DATA_DIR ?? "/tmp/nextflow-studio-e2e";
const demo = join(dataDir, "demo", "docking");
const smiles = join(demo, "ligands.csv");
const receptor = join(demo, "receptor.pdbqt");

const PREPARE_INPUT = (path: string) => [
  "# @input name=smiles type=path required",
  `smiles = "${path}"`,
].join("\n");

const PREPARE_OUTPUT = [
  "# @output name=ligands type=path pattern=ligands.sdf",
  "import csv",
  "from rdkit import Chem",
  "from rdkit.Chem import AllChem",
  'writer = Chem.SDWriter("ligands.sdf")',
  "for row in csv.DictReader(open(smiles)):",
  '    mol = Chem.AddHs(Chem.MolFromSmiles(row["smiles"]))',
  "    AllChem.EmbedMolecule(mol, randomSeed=7)",
  "    AllChem.MMFFOptimizeMolecule(mol)",
  '    mol.SetProp("_Name", row["name"])',
  "    writer.write(mol)",
  "writer.close()",
  'print(f"prepared {len(Chem.SDMolSupplier(\'ligands.sdf\', removeHs=False))} ligands")',
].join("\n");

const DOCK_INPUT = (ligands: string, receptorPath: string, box: { center_x: number; center_y: number; center_z: number; size: number }) => [
  "# @input name=ligands type=path required",
  "# @input name=receptor type=path required",
  `# @input name=center_x type=float default=${box.center_x}`,
  `# @input name=center_y type=float default=${box.center_y}`,
  `# @input name=center_z type=float default=${box.center_z}`,
  `# @input name=size type=float default=${box.size}`,
  "# @input name=exhaustiveness type=int default=4",
  `ligands = "${ligands}"`,
  `receptor = "${receptorPath}"`,
  `center_x = ${box.center_x}`,
  `center_y = ${box.center_y}`,
  `center_z = ${box.center_z}`,
  `size = ${box.size}`,
  "exhaustiveness = 4",
].join("\n");

const DOCK_OUTPUT = [
  "# @output name=poses type=path pattern=poses.pdbqt",
  "# @output name=scores type=path pattern=scores.csv",
  "# @output name=best type=path pattern=best_pose.pdbqt",
  "import csv",
  "from meeko import MoleculePreparation, PDBQTWriterLegacy",
  "from rdkit import Chem",
  "from vina import Vina",
  'v = Vina(sf_name="vina", cpu=0, seed=42, verbosity=0)',
  "v.set_receptor(receptor)",
  "v.compute_vina_maps(center=[center_x, center_y, center_z], box_size=[size] * 3)",
  "scores = []",
  "for mol in Chem.SDMolSupplier(ligands, removeHs=False):",
  '    name = mol.GetProp("_Name")',
  "    pdbqt, ok, error = PDBQTWriterLegacy.write_string(MoleculePreparation().prepare(mol)[0])",
  "    if not ok:",
  '        raise RuntimeError(f"{name}: {error}")',
  "    v.set_ligand_from_string(pdbqt)",
  "    v.dock(exhaustiveness=exhaustiveness, n_poses=5)",
  '    v.write_poses(f"{name}_out.pdbqt", n_poses=5, overwrite=True)',
  "    scores.append((name, round(float(v.energies(n_poses=1)[0][0]), 3)))",
  "scores.sort(key=lambda row: row[1])",
  'with open("scores.csv", "w", newline="") as handle:',
  '    csv.writer(handle).writerows([("ligand", "affinity_kcal_mol"), *scores])',
  'with open("poses.pdbqt", "w") as out:',
  "    for name, _ in scores:",
  '        out.write(open(f"{name}_out.pdbqt").read())',
  'with open(f"{scores[0][0]}_out.pdbqt") as best, open("best_pose.pdbqt", "w") as out:',
  '    out.write(best.read().split("ENDMDL")[0] + "ENDMDL\\n")',
  'print(f"best {scores[0][0]} {scores[0][1]:.2f} kcal/mol")',
].join("\n");

test.describe("docking user path", () => {
  test("RDKit and Vina notebooks to a scored best pose", async ({ page }) => {
    test.setTimeout(30 * 60_000);
    const source = execFileSync("python3", ["scripts/make-docking-demo.py", demo], { encoding: "utf8" }).trim();
    const box = JSON.parse(readFileSync(join(demo, "box.json"), "utf8")) as { center_x: number; center_y: number; center_z: number; size: number };
    // The Vina notebook is developed against a ligand file prepared once here, as a user would after the first notebook.
    const scratch = join(dataDir, "demo", "docking-scratch");
    mkdirSync(scratch, { recursive: true });
    execFileSync("python3", ["-c", `${PREPARE_INPUT(smiles)}\n${PREPARE_OUTPUT}`], { cwd: scratch });
    const preparedLigands = join(scratch, "ligands.sdf");

    const stamp = Date.now().toString(36);
    const prepareName = `rdkit_ligands_${stamp}`;
    const dockName = `vina_dock_${stamp}`;

    await page.goto("/workflows");
    await expect(page.getByText(/Nextflow \d/)).not.toContainText("模拟", { timeout: 60_000 });

    await notebookModule(page, prepareName, [
      { source: PREPARE_INPUT(smiles), role: "input" },
      { source: PREPARE_OUTPUT, role: "output" },
    ], [{ cell: 1 }, { cell: 2, text: /prepared 3 ligands/ }], { port: "smiles", path: smiles }, "e2e-dock");

    await notebookModule(page, dockName, [
      { source: DOCK_INPUT(preparedLigands, receptor, box), role: "input" },
      { source: DOCK_OUTPUT, role: "output" },
    ], [{ cell: 1 }, { cell: 2, text: /best \w+ -?\d+\.\d+ kcal\/mol/ }], [{ port: "ligands", path: preparedLigands }, { port: "receptor", path: receptor }], "e2e-dock");

    await page.goto("/workflows");
    await page.getByRole("button", { name: "新建", exact: true }).click();
    await page.waitForURL(/\/workflows\/(?!modules$)[^/]+$/);
    await page.getByRole("textbox", { name: "流程名称" }).fill(`分子对接 ${stamp}`);
    const ligandsRef = await addReference(page, "ligands", smiles);
    await page.getByRole("button", { name: /zoom out/i }).click();
    await page.getByRole("button", { name: /zoom out/i }).click();
    const pane = await page.locator(".react-flow__pane").boundingBox();
    const header = await ligandsRef.boundingBox();
    if (!pane || !header) throw new Error("画布没有渲染");
    await page.mouse.move(header.x + 30, header.y + 12);
    await page.mouse.down();
    await page.mouse.move(pane.x + 60, pane.y + pane.height / 4, { steps: 12 });
    await page.mouse.up();

    await extend(page, ligandsRef, "file", prepareName);
    const prepare = page.locator(".react-flow__node").filter({ hasText: prepareName.toUpperCase() });
    await expect(prepare).toBeVisible();
    await extend(page, prepare, "ligands", dockName);
    const dock = page.locator(".react-flow__node").filter({ hasText: dockName.toUpperCase() });
    await expect(dock).toBeVisible();

    const receptorRef = await addReference(page, "receptor", receptor);
    const receptorHeader = await receptorRef.boundingBox();
    if (!receptorHeader) throw new Error("受体节点没有渲染");
    await page.mouse.move(receptorHeader.x + 30, receptorHeader.y + 12);
    await page.mouse.down();
    await page.mouse.move(pane.x + 60, pane.y + (pane.height * 2) / 3, { steps: 12 });
    await page.mouse.up();
    await connect(page, receptorRef, "file", dock, "receptor");
    await expect(page.locator(".react-flow__edge")).toHaveCount(3);
    await expect(page.getByText("已保存", { exact: true })).toBeVisible({ timeout: 20_000 });
    await shot(page, "e2e-dock-canvas.png");

    await runWithShell(page);

    await page.getByRole("tab", { name: "结果" }).click();
    const results = page.getByRole("tabpanel", { name: "结果" });
    const published = page.locator("li").filter({ has: page.getByRole("button", { name: new RegExp(`^${dockName}/`) }) });
    await published.getByRole("button", { name: /^scores\.csv/ }).click();
    await expect(results.getByRole("table")).toBeVisible({ timeout: 30_000 });
    await expect(results.getByRole("table")).toContainText("ibuprofen");
    await shot(page, "e2e-dock-scores.png");
    await published.getByRole("button", { name: /^best_pose\.pdbqt/ }).click();
    await expect(results.locator("canvas")).toBeVisible({ timeout: 30_000 });
    await expect(results.getByText(/无法显示结构/)).toHaveCount(0);
    await page.waitForTimeout(1_500);
    await shot(page, "e2e-dock-pose.png");

    for (const dir of artifactDirs) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "e2e-dock-notes.md"), [
        "# docking user path",
        "",
        `- receptor: ${source}`,
        `- modules: ${prepareName}, ${dockName}`,
        `- run: ${page.url()}`,
        "- notebook cells ran in the persistent Jupyter kernel; try-run and run used the host python3 with vina, meeko and rdkit",
        "",
      ].join("\n"));
    }
  });
});
