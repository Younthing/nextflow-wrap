# 第二课：分子对接（AutoDock Vina）

目标：一个 RDKit 笔记本把 SMILES 变成 3D 配体，一个 Vina 笔记本在 CPU 上把它们对接到受体口袋；流程输出打分表和最佳构象，在结果页用 Mol* 旋转查看。约 15 分钟。

## 准备数据

```bash
python3 scripts/make-docking-demo.py ~/nfs-demo/docking
```

生成 `receptor.pdbqt`、`ligands.csv`（阿司匹林、布洛芬、咖啡因三个 SMILES）和 `box.json`（搜索盒中心和边长）。
默认受体是一个**合成口袋**，没有生物学意义，只用来离线演示整条链路。要对接真实蛋白，先把受体准备成 PDBQT（例如 Meeko 的 `mk_prepare_receptor.py`），再：

```bash
DOCKING_RECEPTOR_PDBQT=/path/receptor.pdbqt DOCKING_BOX="12.5,8.0,-3.2,22" python3 scripts/make-docking-demo.py ~/nfs-demo/docking
```

需要 Python 里有 `vina`、`meeko`、`rdkit`（首次启动向导的「创建笔记本环境」已包含；自己装用 `python3 -m pip install vina meeko gemmi scipy rdkit`）。

## 1. 配体准备笔记本 `rdkit_ligands`

```python
# @input name=smiles type=path required
smiles = "/Users/me/nfs-demo/docking/ligands.csv"
```

```python
# @output name=ligands type=path pattern=ligands.sdf
import csv
from rdkit import Chem
from rdkit.Chem import AllChem
writer = Chem.SDWriter("ligands.sdf")
for row in csv.DictReader(open(smiles)):
    mol = Chem.AddHs(Chem.MolFromSmiles(row["smiles"]))
    AllChem.EmbedMolecule(mol, randomSeed=7)
    AllChem.MMFFOptimizeMolecule(mol)
    mol.SetProp("_Name", row["name"])
    writer.write(mol)
writer.close()
```

运行后发布为模块，试跑时 `smiles` 选「路径」填 `ligands.csv`。

## 2. 对接笔记本 `vina_dock`

```python
# @input name=ligands type=path required
# @input name=receptor type=path required
# @input name=center_x type=float default=0
# @input name=center_y type=float default=0
# @input name=center_z type=float default=0
# @input name=size type=float default=18
# @input name=exhaustiveness type=int default=8
ligands = "/Users/me/nfs-demo/docking/ligands.sdf"   # 先在上一个笔记本的工作目录里拿到
receptor = "/Users/me/nfs-demo/docking/receptor.pdbqt"
center_x, center_y, center_z, size, exhaustiveness = 0, 0, 0, 18, 8
```

输出单元格用 Meeko 把每个配体转成 PDBQT，用 Vina 对接，写出 `scores.csv`（按结合能排序）、`poses.pdbqt`（全部构象）和 `best_pose.pdbqt`（最好的一个）。
完整代码见仓库 `e2e/docking.spec.ts` 里的 `DOCK_OUTPUT`。`exhaustiveness` 越大越慢越稳，演示用 4–8 即可；`cpu=0` 表示用满本机核。

发布时试跑要给 `ligands` 和 `receptor` 都选「路径」。数值参数（中心、边长）会变成画布节点上的输入框。

## 3. 连成流程

1. 新建流程，拖入两个「参考文件」：`ligands` → `ligands.csv`，`receptor` → `receptor.pdbqt`。
2. 从 `ligands` 参考拖线到空白处选 `rdkit_ligands`；再从它的 `ligands` 输出拖线选 `vina_dock`。
3. 把 `receptor` 参考的输出端口直接拖到 `vina_dock` 的 `receptor` 输入。
4. 在 `vina_dock` 节点上按 `box.json` 填口袋中心和边长。
5. 运行，「容器 / 环境」选 Shell。

## 4. 看结果

- `scores.csv`：每个配体的最佳结合能（kcal/mol，越低越好）。
- `best_pose.pdbqt` / `poses.pdbqt`：在 Mol* 3D 视图中打开，拖动旋转、滚轮缩放。
- 在桌面版里「在 Finder 中显示」可以把构象交给 PyMOL、ChimeraX 等工具。

换一批配体只需要改 `ligands.csv` 后点「续跑」：受体网格不变，已对接过的配体会命中缓存。
